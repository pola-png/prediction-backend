/**
 * Configuration for football data sources
 */

// OpenFootball JSON data sources for initial seeding
const FOOTBALL_JSON_SOURCES = {
  // Premier League
  'PL': {
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json',
    name: 'Premier League',
    country: 'England'
  },
  // La Liga
  'LA': {
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/es.1.json',
    name: 'La Liga',
    country: 'Spain'
  },
  // Bundesliga
  'BL': {
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/de.1.json',
    name: 'Bundesliga',
    country: 'Germany'
  },
  // Serie A
  'SA': {
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/it.1.json',
    name: 'Serie A',
    country: 'Italy'
  },
  // Ligue 1
  'L1': {
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/fr.1.json',
    name: 'Ligue 1',
    country: 'France'
  }
};

// OpenLigaDB API endpoints for live updates
const OPENLIGA_DB_SOURCES = {
  // Bundesliga
  'BL': {
    id: 'bl1',
    name: 'Bundesliga',
    country: 'Germany'
  },
  // 2. Bundesliga
  'BL2': {
    id: 'bl2',
    name: '2. Bundesliga',
    country: 'Germany'
  }
};

// Base URLs for different data sources
const API_URLS = {
  OPENLIGA_DB: 'https://www.openligadb.de/api',
  FOOTBALL_DATASETS: 'https://raw.githubusercontent.com/footballcsv/england/master/2020s' // Example historical data source
};

module.exports = {
  FOOTBALL_JSON_SOURCES,
  OPENLIGA_DB_SOURCES,
  API_URLS
};
