import PocketBase from 'pocketbase';

// Create a singleton instance of PocketBase
let pocketBaseInstance: PocketBase;

// On the server-side, we can access process.env directly
// On the client-side, we'll use a default URL which can be overridden by environment
const pocketBaseURL = typeof process !== 'undefined' && process.env?.POCKETBASE_URL
  ? process.env.POCKETBASE_URL
  : typeof window !== 'undefined' && window.location
    ? `${window.location.protocol}//${window.location.hostname}:8090`
    : 'http://localhost:8090';

pocketBaseInstance = new PocketBase(pocketBaseURL);

export default pocketBaseInstance;