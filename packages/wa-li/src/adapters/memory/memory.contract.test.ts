import { runAdapterContract } from "../contract";
import { memoryAdapter } from ".";

runAdapterContract("memory", () => memoryAdapter());
