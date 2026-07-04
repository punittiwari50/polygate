import Redis from "ioredis";

const redisHost = process.env.REDIS_HOST || "127.0.0.1";
const redisPort = Number(process.env.REDIS_PORT) || 6379;
const keyPrefix = process.env.REDIS_PREFIX || "polygate:";

console.log("=================================================");
console.log("   PolyGate — Redis Connection Diagnostic Script ");
console.log("=================================================");
console.log(`Configuration:`);
console.log(`  - Host: ${redisHost}`);
console.log(`  - Port: ${redisPort}`);
console.log(`  - Prefix: ${keyPrefix}`);
console.log("-------------------------------------------------");

const client = new Redis({
  host: redisHost,
  port: redisPort,
  keyPrefix,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000
});

async function runDiagnostics() {
  try {
    console.log("Attempting connection to Redis server...");
    const pingResponse = await client.ping();
    console.log(`Connection Success! Redis ping response: ${pingResponse}`);
    
    const keys = await client.keys("*");
    console.log(`Diagnostic: Found ${keys.length} keys in database.`);
    
    console.log("Diagnostic check finished successfully.");
    process.exit(0);
  } catch (err: any) {
    console.warn(`Connection Failed: ${err.message}`);
    console.warn("\nRecommendation:");
    console.warn("  - Ensure Redis server is installed and running locally on port 6379.");
    console.warn("  - Or verify environmental variables (REDIS_HOST / REDIS_PORT).");
    console.warn("  - PolyGate will fall back to a mock/in-memory NoSQL storage driver.");
    process.exit(0);
  }
}

runDiagnostics();
