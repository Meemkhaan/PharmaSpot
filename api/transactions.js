let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
let Datastore = require("@seald-io/nedb");
let Inventory = require("./inventory");
const path = require("path");
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;
const dbPath = path.join(
  appData,
  appName,
  "server",
  "databases",
  "transactions.db",
);

app.use(bodyParser.json());

module.exports = app;

let transactionsDB = new Datastore({
  filename: dbPath,
  autoload: true,
});

transactionsDB.ensureIndex({ fieldName: "_id", unique: true });

/**
 * GET endpoint: Get the welcome message for the Transactions API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
  res.send("Transactions API");
});

/**
 * GET endpoint: Get details of all transactions.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/all", function (req, res) {
  transactionsDB.find({}, function (err, docs) {
    res.send(docs);
  });
});

/**
 * GET endpoint: Get on-hold transactions.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/on-hold", function (req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: { $ne: "" } }, { status: 0 }] },
    function (err, docs) {
      if (docs) res.send(docs);
    },
  );
});

/**
 * GET endpoint: Get customer orders with a status of 0 and an empty reference number.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/customer-orders", function (req, res) {
  transactionsDB.find(
    { $and: [{ customer: { $ne: "0" } }, { status: 0 }, { ref_number: "" }] },
    function (err, docs) {
      if (docs) res.send(docs);
    },
  );
});

/**
 * GET endpoint: Get transactions based on date, user, and till parameters.
 *
 * @param {Object} req request object with query parameters.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/by-date", function (req, res) {
  const startDate = new Date(req.query.start);
  const endDate = new Date(req.query.end);

  const baseFilters = [];

  // Optional status filter (skip when 'all')
  if (req.query.status !== 'all') {
    baseFilters.push({ status: parseInt(req.query.status) });
  }

  // Optional user filter (tolerant of string/number)
  if (req.query.user != 0) {
    const userNum = parseInt(req.query.user);
    const userStr = req.query.user.toString();
    baseFilters.push({ user_id: { $in: [userNum, userStr] } });
  }

  // Optional till filter (tolerant of string/number)
  if (req.query.till != 0) {
    const tillNum = parseInt(req.query.till);
    const tillStr = req.query.till.toString();
    baseFilters.push({ till: { $in: [tillNum, tillStr] } });
  }

  const query = baseFilters.length > 0 ? { $and: baseFilters } : {};

  transactionsDB.find(query, function (err, docs) {
    if (err) {
      console.error('Transactions query error:', err);
      return res.status(500).json({ error: 'Query error' });
    }

    // Normalize and filter by date in JS to handle both Date and string-stored dates
    const filtered = (docs || []).filter((t) => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      if (isNaN(d.getTime())) return false;
      return d >= startDate && d <= endDate;
    });

    res.send(filtered);
  });
});

/**
 * POST endpoint: Create a new transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/new", async function (req, res) {
  const newTransaction = req.body;
  
  console.log('=== NEW TRANSACTION RECEIVED ===');
  console.log('Transaction data:', JSON.stringify(newTransaction, null, 2));
  const paidAmount = parseFloat(newTransaction.paid) || 0;
  const totalAmount = parseFloat(newTransaction.total) || 0;

  console.log('Paid:', paidAmount, 'Total:', totalAmount);
  console.log('Items:', newTransaction.items);

  try {
    const transaction = await new Promise((resolve, reject) => {
      transactionsDB.insert(newTransaction, function (err, doc) {
        if (err) {
          return reject(err);
        }
        return resolve(doc);
      });
    });

    console.log('Transaction saved successfully:', transaction._id);

    let inventorySummary = null;
    if (paidAmount >= totalAmount) {
      console.log('Transaction fully paid - decrementing inventory...');
      console.log('Inventory module type:', typeof Inventory);
      console.log('Inventory.decrementInventory type:', typeof Inventory.decrementInventory);
      
      if (typeof Inventory.decrementInventory === 'function') {
        try {
          inventorySummary = await Inventory.decrementInventory(newTransaction.items);
          console.log('✅ Inventory decrement completed successfully');
        } catch (error) {
          console.error('❌ Error during inventory decrement:', error);
          inventorySummary = { error: error.message || String(error) };
        }
      } else {
        const typeError = 'Inventory.decrementInventory is not a function!';
        console.error(`❌ ${typeError}`);
        console.error('Inventory object keys:', Object.keys(Inventory || {}));
        inventorySummary = { error: typeError };
      }
    } else {
      console.log(`Transaction NOT fully paid (paid: ${paidAmount}, total: ${totalAmount}) - skipping inventory decrement`);
    }

    res.status(200).json({
      success: true,
      transactionId: transaction._id,
      inventory: inventorySummary
    });
  } catch (err) {
    console.error('Transaction insert error:', err);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to save transaction.",
      details: err && err.message ? err.message : err
    });
  }
});

/**
 * PUT endpoint: Update an existing transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.put("/new", function (req, res) {
  let oderId = req.body._id;
  transactionsDB.update(
    {
      _id: oderId,
    },
    req.body,
    {},
    function (err, numReplaced, order) {
      if (err) {
        console.error(err);
        res.status(500).json({
          error: "Internal Server Error",
          message: "An unexpected error occurred.",
        });
      } else {
        res.sendStatus(200);
      }
    },
  );
});

/**
 * POST endpoint: Delete a transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/delete", function (req, res) {
  let transaction = req.body;
  transactionsDB.remove(
    {
      _id: transaction.orderId,
    },
    function (err, numRemoved) {
      if (err) {
        console.error(err);
        res.status(500).json({
          error: "Internal Server Error",
          message: "An unexpected error occurred.",
        });
      } else {
        res.sendStatus(200);
      }
    },
  );
});

/**
 * GET endpoint: Get details of a specific transaction by transaction ID.
 *
 * @param {Object} req request object with transaction ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/:transactionId", function (req, res) {
  transactionsDB.find({ _id: req.params.transactionId }, function (err, doc) {
    if (doc) res.send(doc[0]);
  });
});
