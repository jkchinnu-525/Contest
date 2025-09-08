import { initializeEngine } from "./index.js";

async function startEngine() {
  try {
    await initializeEngine();
    console.log("Engine has started");
  } catch (error) {
    console.log("Engine has failed to start", error);
  }
}

startEngine();
