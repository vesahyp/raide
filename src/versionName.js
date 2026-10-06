/**
 * A name for a build, derived from its id, so two people can compare
 * versions by ear. Used by vite.config.ts for version.json and by the app
 * for the title screen, so the lists live here and nowhere else. Plain
 * JavaScript with a .d.ts beside it: a .ts file here would sit in both
 * TypeScript programs and the project reference refuses that.
 * Railway words: an adjective and a thing on the line.
 */
const FIRST = ['Sininen', 'Punainen', 'Harmaa', 'Musta', 'Vihreä', 'Kultainen', 'Hiljainen', 'Märkä', 'Kuiva', 'Vanha', 'Nuori', 'Villi', 'Kylmä', 'Lämmin', 'Sumuinen', 'Kirkas', 'Ruskea', 'Valkea', 'Pölyinen', 'Pitkä', 'Lyhyt', 'Jäinen', 'Palanut', 'Ruosteinen', 'Terävä', 'Pyöreä', 'Laiska', 'Vinha', 'Salainen', 'Iloinen', 'Vihainen', 'Uninen'];
const SECOND = ['Raide', 'Veturi', 'Vaunu', 'Silta', 'Asema', 'Vaihde', 'Laituri', 'Ratapiha', 'Tunneli', 'Kisko', 'Pölkky', 'Semafori', 'Tukki', 'Lauta', 'Saha', 'Metsä', 'Joki', 'Järvi', 'Harju', 'Kaupunki', 'Satama', 'Kuorma', 'Höyry', 'Savu', 'Hiili', 'Halko', 'Tasoristeys', 'Veturitalli', 'Ratavalli', 'Pysäkki', 'Kaarre', 'Suora'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function versionName(build) {
  const h = hash(build);
  return `${FIRST[h % FIRST.length]} ${SECOND[(h >>> 8) % SECOND.length]}`;
}
