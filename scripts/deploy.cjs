const hre = require("hardhat");

async function main() {
  const DriftComposer = await hre.ethers.getContractFactory("DriftComposer");
  const drift = await DriftComposer.deploy();
  await drift.waitForDeployment();

  const address = await drift.getAddress();
  console.log(`DriftComposer deployed to: ${address}`);

  console.log("\nAdd this to your .env.local:");
  console.log(`NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS=${address}`);
  console.log("\nSessions are now user-created. No auto-start needed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
