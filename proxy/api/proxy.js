const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI; 
const secretKey = process.env.APP_SECRET_KEY; 

let client;
let clientPromise;

if (!global._mongoClientPromise) {
  client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

export default async function handler(req, res) {
  // CORS Setup to allow your React App to connect
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Security Check
  if (req.headers['api-key'] !== secretKey) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const client = await clientPromise;
    const db = client.db(req.body.database || 'WhatsAppTracker');
    const col = db.collection(req.body.collection);

    let result;
    const { action, filter, update, limit, sort } = req.body;

    // Apply dynamic sorting and limits sent from the React App
    const findOptions = {};
    if (sort) findOptions.sort = sort;
    if (limit) findOptions.limit = limit;

    if (action === 'findOne') {
        result = await col.findOne(filter, findOptions);
        return res.status(200).json({ document: result });
    } 
    else if (action === 'find') {
        result = await col.find(filter, findOptions).toArray();
        return res.status(200).json({ documents: result });
    } 
    else if (action === 'updateOne') {
        result = await col.updateOne(filter, update, { upsert: true });
        return res.status(200).json(result);
    }
    
    return res.status(400).json({ error: 'Invalid action' });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
