const major = Number(process.versions.node.split(".")[0]);

if (major !== 18) {
  console.error(`Node.js ${process.version} is not supported. Run: nvm use 18`);
  process.exit(1);
}
