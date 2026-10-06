//#region src/game/grid.ts
/** the eight directions as (dx, dy); bit i of a track mask means track leaves the cell in DIRS[i] */
var DIRS = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1]
];
var idx = (s, cx, cy) => cy * s.w + cx;
var cx = (s, i) => i % s.w;
var cy = (s, i) => Math.floor(i / s.w);
var inside = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;
function dirIndex(dx, dy) {
	return DIRS.findIndex(([x, y]) => x === dx && y === dy);
}
/** the length of a step in cells: 1 straight, root two diagonal */
function stepLen(dx, dy) {
	return dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
}
/** the cell cost of laying track across cell i, in money; 0 when track is there already */
function cellCost(s, i) {
	if (s.track[i]) return 0;
	return s.water[i] ? 4 : 1;
}
/** whether a cell can carry track at all: a site's cell only as a station */
function passable(s, i, end) {
	if (i === end) return true;
	return !s.sites.some((site) => idx(s, site.cx, site.cy) === i);
}
/**
* A* from a cell to a cell. The step cost is the cell's price times the step's length, plus a
* small constant so a free run over old track still prefers the short way. Returns null when
* there is no path.
*/
function route(s, from, to) {
	if (from === to) return null;
	const n = s.w * s.h;
	const g = new Float64Array(n).fill(Infinity);
	const prev = new Int32Array(n).fill(-1);
	const closed = new Uint8Array(n);
	const tx = cx(s, to);
	const ty = cy(s, to);
	const h = (i) => {
		const dx = Math.abs(cx(s, i) - tx);
		const dy = Math.abs(cy(s, i) - ty);
		return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
	};
	const open = [from];
	g[from] = 0;
	while (open.length) {
		let bi = 0;
		for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
		const cur = open.splice(bi, 1)[0];
		if (cur === to) break;
		if (closed[cur]) continue;
		closed[cur] = 1;
		const x = cx(s, cur);
		const y = cy(s, cur);
		for (const [dx, dy] of DIRS) {
			const nx = x + dx;
			const ny = y + dy;
			if (!inside(s, nx, ny)) continue;
			const ni = idx(s, nx, ny);
			if (closed[ni] || !passable(s, ni, to)) continue;
			if (dx !== 0 && dy !== 0 && s.water[idx(s, x + dx, y)] && s.water[idx(s, x, y + dy)] && !s.water[ni] && !s.water[cur]) continue;
			const len = stepLen(dx, dy);
			const c = g[cur] + (cellCost(s, ni) + .05) * len;
			if (c < g[ni]) {
				g[ni] = c;
				prev[ni] = cur;
				open.push(ni);
			}
		}
	}
	if (prev[to] < 0) return null;
	const cells = [];
	for (let i = to; i !== -1; i = prev[i]) cells.push(i);
	cells.reverse();
	const added = cells.filter((i) => !s.track[i]);
	const bridge = added.filter((i) => s.water[i] === 1);
	const newStation = !s.stations.some((st) => st.cell === to);
	let cost = 0;
	for (const i of added) cost += s.water[i] ? 4 : 1;
	if (newStation) cost += 20;
	let length = 0;
	for (let k = 1; k < cells.length; k++) length += stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1]));
	return {
		cells,
		cost,
		bridge,
		added,
		newStation,
		length
	};
}
/** link two neighbouring cells with track, both ways */
function link(s, a, b) {
	const d = dirIndex(cx(s, b) - cx(s, a), cy(s, b) - cy(s, a));
	if (d < 0) throw new Error(`cells ${a} and ${b} are not neighbours`);
	s.track[a] |= 1 << d;
	s.track[b] |= 1 << (d + 4) % 8;
}
/** the track neighbours of a cell */
function linked(s, i) {
	const out = [];
	const m = s.track[i];
	for (let d = 0; d < 8; d++) if (m & 1 << d) out.push(idx(s, cx(s, i) + DIRS[d][0], cy(s, i) + DIRS[d][1]));
	return out;
}
//#endregion
//#region src/game/content/economy.ts
/** a raw site's loads per month, its cap, and the extra rate a served site reaches */
var FOREST_RATE = .6;
/** seconds the Cancel button stays under the thumb after a build */
var UNDO_SECONDS = 1.5;
//#endregion
//#region src/game/state.ts
function createState(sc) {
	const water = new Uint8Array(sc.w * sc.h);
	for (const i of sc.water) water[i] = 1;
	const sites = sc.sites.map((d) => ({
		...d,
		stock: d.kind === "forest" ? 3 : 0,
		taken: 0,
		delivered: 0,
		rate: d.kind === "forest" ? FOREST_RATE : 0,
		lastPickup: -Infinity
	}));
	for (const d of sc.sites) water[idx(sc, d.cx, d.cy)] = 0;
	const s = {
		scenario: sc,
		w: sc.w,
		h: sc.h,
		water,
		track: new Uint8Array(sc.w * sc.h),
		sites,
		stations: [],
		lines: [],
		trains: [],
		cash: sc.cash,
		time: 0,
		year: sc.startYear,
		yearFrac: 0,
		month: 0,
		income: {
			timber: 0,
			boards: 0
		},
		yearEnd: null,
		perks: [],
		goalCount: 0,
		result: null,
		floats: [],
		sounds: [],
		lastBuild: null,
		firstPayAt: null,
		nextId: 1
	};
	const start = sc.sites.find((d) => d.id === sc.startStation);
	s.stations.push({
		id: s.nextId++,
		cell: idx(s, start.cx, start.cy),
		siteId: start.id
	});
	return s;
}
function siteAt(s, cell) {
	return s.sites.find((x) => idx(s, x.cx, x.cy) === cell);
}
function stationAt(s, cell) {
	return s.stations.find((x) => x.cell === cell);
}
//#endregion
//#region src/game/content/scenarios.ts
function water(w, h, fill) {
	const out = [];
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fill(x, y)) out.push(y * w + x);
	return out;
}
var W = 16;
var H = 24;
/** the river winds across the lower map; a lake sits in the top right corner */
function sawmillWater(x, y) {
	const river = 15.5 + Math.sin(x * .42 + .6) * 1.3;
	if (Math.abs(y + .5 - river) < 1.7) return true;
	const lx = (x + .5 - 13.6) / 2.6;
	const ly = (y + .5 - 3.2) / 2.1;
	if (lx * lx + ly * ly < 1) return true;
	return false;
}
var SAWMILL = {
	id: "sawmill",
	name: {
		fi: "Saha",
		en: "Sawmill"
	},
	w: W,
	h: H,
	water: water(W, H, sawmillWater),
	sites: [
		{
			id: "forest",
			kind: "forest",
			name: {
				fi: "Kuusikko",
				en: "Kuusikko"
			},
			cx: 3,
			cy: 5
		},
		{
			id: "sawmill",
			kind: "sawmill",
			name: {
				fi: "Koskensaha",
				en: "Koskensaha"
			},
			cx: 9,
			cy: 11
		},
		{
			id: "town",
			kind: "town",
			name: {
				fi: "Hämeenlinna",
				en: "Hämeenlinna"
			},
			cx: 10,
			cy: 20
		}
	],
	startStation: "forest",
	cash: 150,
	startYear: 1862,
	goal: {
		good: "boards",
		site: "town",
		count: 20,
		beforeYear: 1866
	}
};
//#endregion
//#region src/game/sim.ts
/** the world position of a cell's centre, in cells */
function centre(s, i) {
	return {
		x: cx(s, i) + .5,
		y: cy(s, i) + .5
	};
}
/** the route a drag from a station cell to a site or station cell would build, or null */
function plan(s, from, to) {
	if (!stationAt(s, from)) return null;
	if (!siteAt(s, to) && !stationAt(s, to)) return null;
	return route(s, from, to);
}
function pathDist(s, cells) {
	const dist = [0];
	for (let k = 1; k < cells.length; k++) dist.push(dist[k - 1] + stepLen(cx(s, cells[k]) - cx(s, cells[k - 1]), cy(s, cells[k]) - cy(s, cells[k - 1])));
	return dist;
}
/**
* Build a planned route: pay, lay the track, place the station at the end when there is none,
* and make the line between the two stations when there is none. Returns the line, or null
* when the cash is short.
*/
function build(s, r) {
	if (r.cost > s.cash) return null;
	s.cash -= r.cost;
	for (let k = 1; k < r.cells.length; k++) link(s, r.cells[k - 1], r.cells[k]);
	const from = r.cells[0];
	const to = r.cells[r.cells.length - 1];
	let station = stationAt(s, to);
	let newStation = null;
	if (!station) {
		station = {
			id: s.nextId++,
			cell: to,
			siteId: siteAt(s, to).id
		};
		s.stations.push(station);
		newStation = station.id;
	}
	const a = stationAt(s, from);
	let line = s.lines.find((l) => l.stops[0] === a.id && l.stops[1] === station.id || l.stops[0] === station.id && l.stops[1] === a.id);
	let newLine = null;
	if (!line) {
		line = {
			id: s.nextId++,
			stops: [a.id, station.id],
			path: r.cells,
			dist: pathDist(s, r.cells),
			block: new Set(r.cells.slice(1, -1))
		};
		s.lines.push(line);
		newLine = line.id;
	}
	s.lastBuild = {
		cost: r.cost,
		cells: r.added,
		station: newStation,
		line: newLine,
		left: UNDO_SECONDS,
		cell: to
	};
	const p = centre(s, to);
	s.floats.push({
		x: p.x,
		y: p.y,
		text: `-${r.cost}`,
		age: 0,
		kind: "cost"
	});
	s.sounds.push("build");
	return line;
}
//#endregion
//#region tools/dbg/masks.ts
var s = createState(SAWMILL);
var site = (id) => {
	const x = s.sites.find((o) => o.id === id);
	return idx(s, x.cx, x.cy);
};
var r = plan(s, site("forest"), site("sawmill"));
build(s, r);
for (const c of r.cells) console.log(c, cx(s, c), cy(s, c), "mask", s.track[c].toString(2).padStart(8, "0"), "linked", linked(s, c).map((j) => `(${cx(s, j)},${cy(s, j)})`).join(" "), "centre", centre(s, c));
//#endregion
export {};
