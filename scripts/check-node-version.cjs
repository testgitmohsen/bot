const major = Number(process.versions.node.split(".")[0]);

if (major < 22) {
  console.error(`Node.js ${process.version} is not supported. Run: nvm use 22.19.0`);
  process.exit(1);
}
