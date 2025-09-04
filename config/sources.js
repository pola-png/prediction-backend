const sources = (process.env.FOOTBALL_DATA_SOURCES || "footballjson,openligadb")
  .split(",")
  .map(s => s.trim());

console.log("⚽ Using data sources:", sources);

module.exports = sources;
