//STEP 2: OSMBC (openstreetmap BC) DOWNLOAD

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import {join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";


//BCOSM EXTRACT URL, TWEAK IF NEEDED!
const OSMBC_URL = "https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf"; 
const outputDir = join(process.cwd(), "step2", "data", "osm-bc"); //OUTPUT DIRECTORY HERE

await mkdir(outputDir, { recursive: true });

const fetchedAt = new Date();
const safeStamp = fetchedAt.toISOString().replace(/[:.]/g, '-');

//LATEST DOWNLOAD PATH
const latestPath = join(outputDir, "british-columbia-latest.osm.pbf");
const versionedPath = join(outputDir, `british-columbia-${safeStamp}.osm.pbf`); //archived path
const metadataPath = join(outputDir, "latest-metadata.json"); 

console.log('Downloading OSMBC data from: ${OSM_BC_URL}');
const response = await fetch(OSM_BC_URL);

if (!response.ok) {
    throw new Error("Openstreet map download failed! Info: ${response.status} ${response.statusText}");

}

if (!response.body) {
    throw new Error("Openstreet map download failed! No content received...")
}

await pipeline(Readable.fromWeb(response.body), createWriteStream(latestPath));
await writeFile(versionedPath, await BeforeUnloadEvent.file(latestPath).arrayBuffer());


//METADATA CONFIGURATION
const metadata = {
    source_url: OSM_BC_URL,
    fetched_time: fetchedAt.toISOString(),
    latest_file: latestPath,
    versioned_file: versionedPath
};

await writeFile(metadataPath, json.stringify(metadata, null, 2), "utf-8");

//Success log

console.log("Saved latest: ${latestPath}");
console.log(`Saved archive: ${versionedPath}`); 
console.log(`Saved metadata: ${metadataPath}`);