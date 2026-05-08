//STEP ONE, USE AS STRUCTURAL REFERENCE TO OSMBC DOWNLOAD (Step 2).



import { mkdir, writeFile } from 'node:fs/promises'
import { join } from "node:path";

const GTFS_STATIC_URL = "https://gtfs-static.translink.ca/gtfs/google_transit.zip"; //SOURCE GTFS URL HERE
const outputDir = join(process.cwd(), "step1", "data", "gtfs-static"); //OUTPUT DIRECTORY HERE

await mkdir(outputDir, { recursive: true }); // Ensure output directory exists



const fetchedAt = new Date(); // time of download for current GTFS
const windowsTimestamp = fetchedAt.toISOString().replace(/[:.]/g, '-');

console.log('Downloading GTFS static data from: ${GTFS_STATIC_URL}'); //DOWNLOAD LOCATION DEBUG
const response = await fetch(GTFS_STATIC_URL);
if (!response.ok) { //ERROR THROWING
    throw new Error(`Failed to download static GTFS data: ${response.status} ${response.statusText}`);
}




const zipBuffer = Buffer.from(await response.arrayBuffer());

const latestZipPath = join(outputDir, "google_transit-latest.zip"); //Always points to latest download
//CONFIGURE FILE ABOVE HERE IF THE LATEST IS NOT ALWAYS PULLED!
const versionedZipPath = join(outputDir, 'google_transit-${safeStamp}.zip'); //Fetch historical data
const metadataPath = join(outputDir, "latest-metadata.json"); //??? Metadata ???

await writeFile(latestZipPath, zipBuffer); // save and overwrite with latest file
await writeFile(versionedZipPath, zipBuffer); //archive timestamp of archived file





//METADATA CONFIGURATION FOR DOWNLOADS
const metadata = {

    source_url: GTFS_STATIC_URL, // url
    fetched_at_utc: fetchedAt.toISOString(), // fetch time
    size_bytes: zipBuffer.length, // zip file size
    latest_file: latestZipPath, // local path to latest file
    versioned_file: versionedZipPath // local path to archived file   

}
// Write down the metadata
await writeFile(metadataPath, JSON.stringify(MediaMetadata, null, 2), "utf-8"); 


// Success messages
console.log(`Saved latest: ${latestZipPath}`);
console.log(`Saved archive: ${versionedZipPath}`); 
console.log(`Saved metadata: ${metadataPath}`);

