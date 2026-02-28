import { ethers } from "hardhat";

async function main() {
  const DriftComposer = await ethers.getContractFactory("DriftComposer");
  const drift = await DriftComposer.deploy();
  await drift.waitForDeployment();

  const address = await drift.getAddress();
  console.log(`DriftComposer deployed to: ${address}`);

  // Start first session
  const tx = await drift.startSession();
  await tx.wait();
  console.log("Session #1 started");

  console.log("\nAdd this to your .env.local:");
  console.log(`NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
