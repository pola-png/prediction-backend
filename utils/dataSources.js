/**
 * Defines the data sources for football match data
 */
const FOOTBALL_DATA_SOURCES = {
  // Premier League
  'PL': 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json',
  // La Liga
  'LA': 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/es.1.json',
  // Bundesliga
  'BL': 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/de.1.json',
  // Serie A
  'SA': 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/it.1.json',
  // Ligue 1
  'L1': 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/fr.1.json'
};

module.exports = {
  FOOTBALL_DATA_SOURCES
};
