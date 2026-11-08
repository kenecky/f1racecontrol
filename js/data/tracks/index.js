// Verzeichnis aller Strecken
import { RED_BULL_RING } from './redbullring.js';
import albertpark from './albertpark.js';
import shanghai from './shanghai.js';
import suzuka from './suzuka.js';
import bahrain from './bahrain.js';
import jeddah from './jeddah.js';
import miami from './miami.js';
import montreal from './montreal.js';
import monaco from './monaco.js';
import barcelona from './barcelona.js';
import silverstone from './silverstone.js';
import spa from './spa.js';
import hungaroring from './hungaroring.js';
import zandvoort from './zandvoort.js';
import monza from './monza.js';
import madring from './madring.js';
import baku from './baku.js';
import singapore from './singapore.js';
import cota from './cota.js';
import mexico from './mexico.js';
import interlagos from './interlagos.js';
import lasvegas from './lasvegas.js';
import lusail from './lusail.js';
import yasmarina from './yasmarina.js';

const LIST = [albertpark, shanghai, suzuka, bahrain, jeddah, miami, montreal, monaco, barcelona, RED_BULL_RING, silverstone, spa, hungaroring, zandvoort, monza, madring, baku, singapore, cota, mexico, interlagos, lasvegas, lusail, yasmarina];
export const TRACKS = Object.fromEntries(LIST.map(t => [t.id, t]));
