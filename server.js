const express = require('express');
const hospitalData = require('./city.json');
const specialisationData = require('./spel.json');

const app = express();
const PORT = 3000;

// This endpoint now supports filtering by city and/or specialization
app.get('/api/hospitals', (req, res) => {
  // Get the query parameters from the request URL
  const { city, specialization } = req.query;

  let results = [...hospitalData]; // Start with the full list of hospitals

  // 1. Filter by city if the 'city' parameter is provided
  if (city) {
    results = results.filter(c => c.city.toLowerCase() === city.toLowerCase());
  }

  // 2. Filter by specialization if the 'specialization' parameter is provided
  if (specialization) {
    // Go through the remaining cities and filter their branches
    results = results.map(cityObj => {
      // Keep only the branches that include the requested specialization ID
      const matchingBranches = cityObj.branches.filter(branch =>
        branch.specializationIds.includes(specialization)
      );

      // Return a new city object containing only the matched branches
      return {
        ...cityObj,
        branches: matchingBranches
      };
      // Finally, remove any cities that have no matching branches left
    }).filter(cityObj => cityObj.branches.length > 0);
  }

  // Send back the filtered results
  res.json(results);
});

app.get('/api/specialisations', (req, res) => {
  res.json(specialisationData);
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
