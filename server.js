const express = require('express');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const moment = require('moment'); // For date handling

// ==================== LOAD DATA FILES ====================
const hospitalData = require('./city.json');
const specialisationData = require('./spel.json');
const doctorData = require('./doc.json');
let availabilityData = require('./availability.json'); // Use 'let' as we'll modify it

const app = express();
const PORT = 3000;

// ==================== BODY PARSERS ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer();
app.use(upload.none());

// ==================== DATABASE SETUP ====================
const db = new sqlite3.Database('./hospital.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS patients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          patientName TEXT,
          phoneNo TEXT,
          age INTEGER,
          purposeOfMeet TEXT,
          doctorId TEXT,
          date TEXT, -- Added date column
          day TEXT, -- Day of the week (derived from date)
          startTime TEXT,
          endTime TEXT,
          email TEXT
        )
      `, (err) => {
        if (err) {
          console.error('Error creating or altering patients table:', err.message);
        } else {
          console.log('Patients table is ready.');
        }
      });
    });
  }
});

// Helper function to find a slot in availability data based on day of week
function findSlotByDayOfWeek(availabilityData, doctorId, dayOfWeek, startTime, endTime) {
  const doctor = doctorData.find(d => d.id === doctorId);
  if (!doctor) return null;

  const availabilityEntry = availabilityData.find(a => a.availabilityId === doctor.availabilityId);
  if (!availabilityEntry) return null;

  const daySlots = availabilityEntry.slots[dayOfWeek];
  if (!daySlots) return null;

  return daySlots.find(s => s.startTime === startTime && s.endTime === endTime);
}

// Helper function to update availability.json
function saveAvailability() {
  fs.writeFile('./availability.json', JSON.stringify(availabilityData, null, 2), (writeErr) => {
    if (writeErr) {
      console.error('Error writing availability file:', writeErr.message);
    }
  });
}

// ==================== HOSPITAL ENDPOINTS ====================
// (These endpoints remain the same as they don't directly use date for filtering)
app.get('/api/hospitals', (req, res) => {
  const { city, specialization } = req.query;
  let results = [...hospitalData];

  if (city) {
    results = results.filter(c => c.city.toLowerCase() === city.toLowerCase());
  }

  if (specialization) {
    results = results.map(cityObj => {
      const matchingBranches = cityObj.branches.filter(branch =>
        branch.specializationIds.includes(specialization)
      );
      return { ...cityObj, branches: matchingBranches };
    }).filter(cityObj => cityObj.branches.length > 0);
  }

  res.json(results);
});

app.get('/api/specialisations', (req, res) => {
  res.json(specialisationData);
});

app.get('/api/doctors', (req, res) => {
  const { branchId, specialization } = req.query;
  let results = [...doctorData];

  if (branchId) {
    results = results.filter(doc => doc.branchId === branchId);
  }

  if (specialization) {
    results = results.filter(doc => doc.specializationId === specialization);
  }

  res.json(results);
});

app.get('/api/availability/:doctorId', (req, res) => {
  const doctorId = req.params.doctorId;
  const doctor = doctorData.find(d => d.id === doctorId);

  if (!doctor) {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  const availability = availabilityData.find(a => a.availabilityId === doctor.availabilityId);

  if (!availability) {
    return res.status(404).json({ error: 'Availability not found' });
  }

  res.json({
    doctor: doctor.name,
    specializationId: doctor.specializationId,
    branchId: doctor.branchId,
    availability: availability.slots // This still shows weekly availability
  });
});

app.get('/api/availability-id/:availabilityId', (req, res) => {
  const { availabilityId } = req.params;
  const availability = availabilityData.find(a => a.availabilityId === availabilityId);

  if (!availability) {
    return res.status(404).json({ error: 'Availability not found' });
  }

  res.json(availability.slots);
});

// ==================== BOOKING ====================
app.post('/api/book-slot', (req, res) => {
  const {
    patientName, phoneNo, age, purposeOfMeet, doctorId, date, startTime, endTime, email
  } = req.body;

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!date || !dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  // Validate required fields
  if (!patientName || !doctorId || !date || !startTime || !endTime || !email || !purposeOfMeet) {
    return res.status(400).json({ error: 'Missing required fields. Ensure patientName, doctorId, date, startTime, endTime, email, and purposeOfMeet are provided.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  const doctor = doctorData.find(d => d.id === doctorId);
  if (!doctor) {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  // Get the day of the week from the provided date
  const dayOfWeek = moment(date, 'YYYY-MM-DD').format('dddd'); // e.g., "Monday", "Tuesday"

  // Find the slot based on the day of the week and time
  const slot = findSlotByDayOfWeek(availabilityData, doctorId, dayOfWeek, startTime, endTime);

  if (!slot) {
    return res.status(404).json({ error: `No weekly availability found for doctor ${doctor.name} on ${dayOfWeek} from ${startTime} to ${endTime}.` });
  }

  if (slot.status === 'booked') {
    return res.status(400).json({ error: `The slot ${startTime}-${endTime} on ${dayOfWeek} is already booked for doctor ${doctor.name}. Please choose another slot or date.` });
  }

  slot.status = 'booked'; // Mark as booked

  db.run(
    `INSERT INTO patients (patientName, phoneNo, age, purposeOfMeet, doctorId, date, day, startTime, endTime, email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientName, phoneNo, age, purposeOfMeet, doctorId, date, dayOfWeek, startTime, endTime, email],
    function (err) {
      if (err) {
        console.error('Database insert error:', err.message);
        return res.status(500).json({ error: 'Failed to book slot due to database error.' });
      }

      saveAvailability(); // Save changes to availability.json

      res.status(201).json({
        message: 'Booking confirmed',
        bookingId: this.lastID,
        patientName, phoneNo, age, purposeOfMeet, doctorId, date, day: dayOfWeek, startTime, endTime, email
      });
    }
  );
});

// ==================== PATIENT DATA RETRIEVAL ====================
app.get('/api/patients', (req, res) => {
  db.all(`SELECT id, patientName, phoneNo, age, purposeOfMeet, doctorId, date, day, startTime, endTime, email FROM patients`, [], (err, rows) => {
    if (err) {
      console.error('Database select error:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve patient data.' });
    }

    const detailedRows = rows.map(p => {
      const doctor = doctorData.find(d => d.id === p.doctorId);
      return {
        ...p,
        doctorName: doctor ? doctor.name : null,
        specializationId: doctor ? doctor.specializationId : null,
        branchId: doctor ? doctor.branchId : null
      };
    });
    res.json(detailedRows);
  });
});

app.get('/api/patients/:id', (req, res) => {
  const patientId = req.params.id;
  db.get(`SELECT id, patientName, phoneNo, age, purposeOfMeet, doctorId, date, day, startTime, endTime, email FROM patients WHERE id = ?`, [patientId], (err, row) => {
    if (err) {
      console.error('Database select error:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve patient data.' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const doctor = doctorData.find(d => d.id === row.doctorId);
    const detailedRow = {
      ...row,
      doctorName: doctor ? doctor.name : null,
      specializationId: doctor ? doctor.specializationId : null,
      branchId: doctor ? doctor.branchId : null
    };
    res.json(detailedRow);
  });
});

app.get('/api/patients/email/:email', (req, res) => {
  const patientEmail = req.params.email;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(patientEmail)) {
    return res.status(400).json({ error: 'Invalid email format provided.' });
  }

  db.get(`SELECT id, patientName, phoneNo, age, purposeOfMeet, doctorId, date, day, startTime, endTime, email FROM patients WHERE email = ?`, [patientEmail], (err, row) => {
    if (err) {
      console.error('Database select error by email:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve patient data by email.' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Patient with this email not found.' });
    }

    const doctor = doctorData.find(d => d.id === row.doctorId);
    const detailedRow = {
      ...row,
      doctorName: doctor ? doctor.name : null,
      specializationId: doctor ? doctor.specializationId : null,
      branchId: doctor ? doctor.branchId : null
    };
    res.json(detailedRow);
  });
});


// ==================== APPOINTMENT MODIFICATION ====================

// Endpoint to reschedule an appointment
app.put('/api/appointments/:patientId', (req, res) => {
  const patientId = req.params.patientId;
  const { day, startTime, endTime, purposeOfMeet, date } = req.body; // Added date

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!date || !dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid date format for rescheduling. Please use YYYY-MM-DD.' });
  }

  if (!day || !startTime || !endTime || !purposeOfMeet) {
    return res.status(400).json({ error: 'Missing required fields for rescheduling. Provide day, startTime, endTime, purposeOfMeet, and date.' });
  }

  db.get(`SELECT * FROM patients WHERE id = ?`, [patientId], (err, currentRow) => {
    if (err) {
      console.error('Database select error for reschedule:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve appointment details for rescheduling.' });
    }
    if (!currentRow) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    const doctorId = currentRow.doctorId;
    const oldDay = currentRow.day; // Day of the week from current record
    const oldStartTime = currentRow.startTime;
    const oldEndTime = currentRow.endTime;

    const doctor = doctorData.find(d => d.id === doctorId);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor associated with appointment not found.' });
    }

    // Find the new slot based on the new date's day of the week and time
    const newDayOfWeek = moment(date, 'YYYY-MM-DD').format('dddd');
    const newSlot = findSlotByDayOfWeek(availabilityData, doctorId, newDayOfWeek, startTime, endTime);

    if (!newSlot) {
      return res.status(404).json({ error: `No weekly availability found for doctor ${doctor.name} on ${newDayOfWeek} from ${startTime} to ${endTime}.` });
    }

    if (newSlot.status === 'booked') {
      return res.status(400).json({ error: `The requested slot ${startTime}-${endTime} on ${newDayOfWeek} is already booked. Please choose another slot or date.` });
    }

    // Update the patient record in the database
    db.run(
      `UPDATE patients
       SET date = ?, day = ?, startTime = ?, endTime = ?, purposeOfMeet = ?
       WHERE id = ?`,
      [date, newDayOfWeek, startTime, endTime, purposeOfMeet, patientId],
      function (err) {
        if (err) {
          console.error('Database update error for reschedule:', err.message);
          return res.status(500).json({ error: 'Failed to update appointment due to database error.' });
        }

        // Update availability.json
        // Mark old slot as available
        const oldSlot = findSlotByDayOfWeek(availabilityData, doctorId, oldDay, oldStartTime, oldEndTime);
        if (oldSlot) {
          oldSlot.status = 'available';
        }

        // Mark new slot as booked
        newSlot.status = 'booked';
        saveAvailability(); // Save the changes

        res.json({
          message: 'Appointment rescheduled successfully',
          patientId: patientId,
          doctorId: doctorId,
          newDate: date,
          newDay: newDayOfWeek,
          newStartTime: startTime,
          newEndTime: endTime,
          newPurposeOfMeet: purposeOfMeet
        });
      }
    );
  });
});

// Endpoint to cancel an appointment
app.delete('/api/appointments/:patientId', (req, res) => {
  const patientId = req.params.patientId;

  db.get(`SELECT * FROM patients WHERE id = ?`, [patientId], (err, currentRow) => {
    if (err) {
      console.error('Database select error for cancellation:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve appointment details for cancellation.' });
    }
    if (!currentRow) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    const doctorId = currentRow.doctorId;
    const day = currentRow.day; // Day of the week from current record
    const startTime = currentRow.startTime;
    const endTime = currentRow.endTime;

    db.run(`DELETE FROM patients WHERE id = ?`, [patientId], function (err) {
      if (err) {
        console.error('Database delete error for cancellation:', err.message);
        return res.status(500).json({ error: 'Failed to cancel appointment due to database error.' });
      }

      // Update availability.json: Mark the slot as available
      const doctor = doctorData.find(d => d.id === doctorId);
      if (doctor) {
        const availabilityEntry = availabilityData.find(a => a.availabilityId === doctor.availabilityId);
        if (availabilityEntry && availabilityEntry.slots[day]) {
          const slot = availabilityEntry.slots[day].find(s => s.startTime === startTime && s.endTime === endTime);
          if (slot) {
            slot.status = 'available';
            saveAvailability();
          }
        }
      }

      res.json({
        message: 'Appointment cancelled successfully',
        patientId: patientId
      });
    });
  });
});


// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});
