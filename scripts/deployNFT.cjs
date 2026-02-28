const hre = require("hardhat");

async function main() {
  const DRIFT_COMPOSER = process.env.NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS;
  if (!DRIFT_COMPOSER) {
    throw new Error("NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS not set in .env.local");
  }

  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/display?session=`
    : "https://monadblitz-xi.vercel.app/display?session=";

  const DriftSessionNFT = await hre.ethers.getContractFactory("DriftSessionNFT");
  const nft = await DriftSessionNFT.deploy(DRIFT_COMPOSER, BASE_URL);
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  console.log(`DriftSessionNFT deployed to: ${address}`);
  console.log(`  Linked to DriftComposer: ${DRIFT_COMPOSER}`);
  console.log(`  Animation base URL: ${BASE_URL}`);

  console.log("\nAdd this to your .env.local:");
  console.log(`NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
