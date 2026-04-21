import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(__dirname));

const DATABRICKS_URL = 'https://dbc-f43533dd-29e2.cloud.databricks.com/serving-endpoints/Eurex_agent/invocations';

app.post('/api/databricks', async (req, res) => {
    try {
        const response = await fetch(DATABRICKS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ error: { message: err.message } });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Eurex API Explorer running at http://localhost:${PORT}`);
});
