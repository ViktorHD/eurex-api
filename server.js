import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(__dirname));

const DATABRICKS_URL = 'https://dbc-f43533dd-29e2.cloud.databricks.com/serving-endpoints/Eurex_agent/invocations';

const PAYLOADS = (messages) => [
    { messages },
    { dataframe_records: [{ messages }] },
    { dataframe_records: [{ query: messages.at(-1)?.content ?? '' }] },
    { inputs: { messages } },
];

app.get('/api/status', (req, res) => {
    res.json({ status: 'server running', type: 'node/express' });
});

app.post('/api/databricks', async (req, res) => {
    const token = process.env.DATABRICKS_TOKEN ?? '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const messages = req.body?.messages ?? [];
    let lastStatus = 500;
    let lastBody = '';

    for (const payload of PAYLOADS(messages)) {
        try {
            const resp = await fetch(DATABRICKS_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            lastStatus = resp.status;
            lastBody = await resp.text();

            if (resp.ok) {
                return res.status(200).json(JSON.parse(lastBody));
            }
        } catch (e) {
            return res.status(502).json({ error: { message: e.message } });
        }
    }

    // All formats failed — return last error with full body for diagnosis
    res.status(lastStatus).json({
        error: { message: `HTTP ${lastStatus}`, detail: lastBody }
    });
});

const PORT = process.env.DATABRICKS_APP_PORT ?? 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
