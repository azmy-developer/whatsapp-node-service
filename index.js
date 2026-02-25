// index.js
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

// session_ref -> { client, lastQr, isReady }
const sessions = new Map();

function createSession(sessionRef) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionRef }),
    });

    const state = {
        client,
        lastQr: null,
        isReady: false,
    };
    sessions.set(sessionRef, state);

    client.on('qr', (qr) => {
        state.lastQr = qr;
        state.isReady = false;
        console.log('QR updated for session', sessionRef);
    });

    client.on('ready', () => {
        state.isReady = true;
        state.lastQr = null;
        console.log('WhatsApp ready for session', sessionRef);
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp disconnected', sessionRef, reason);
        state.isReady = false;
    });

    client.initialize();
    return state;
}

function getOrCreateSession(sessionRef) {
    let state = sessions.get(sessionRef);
    if (!state) {
        state = createSession(sessionRef);
    }
    return state;
}

// POST /sessions/start
app.post('/sessions/start', (req, res) => {
    const { account_id, session_ref } = req.body;

    const ref = session_ref || `account-${account_id || Date.now()}`;
    const state = getOrCreateSession(ref);

    const status = state.isReady ? 'connected' : 'waiting_for_qr';

    return res.json({
        session_ref: ref,
        status,
    });
});

// POST /sessions/stop
app.post('/sessions/stop', async (req, res) => {
    const { session_ref } = req.body;
    const state = sessions.get(session_ref);

    if (!state) {
        return res.status(400).json({ error: 'Unknown session_ref' });
    }

    try {
        await state.client.logout();
        await state.client.destroy();
    } catch (e) {
        console.error('Error stopping session', e);
    }

    sessions.delete(session_ref);
    return res.json({ ok: true });
});

// GET /sessions/:ref/qr
app.get('/sessions/:ref/qr', (req, res) => {
    const ref = req.params.ref;
    const state = sessions.get(ref);

    if (!state || !state.lastQr) {
        // مفيش QR متاح (يا إما جاهز أو لسه ماطلعش)
        return res.status(204).end();
    }

    return res.json({ qr: state.lastQr });
});

// GET /conversations?session_ref=...
app.get('/conversations', async (req, res) => {
    const { session_ref } = req.query;
    const state = sessions.get(session_ref);

    if (!state) {
        return res.status(400).json({ error: 'Unknown session_ref' });
    }

    try {
        const chats = await state.client.getChats();

        const conversations = chats.map((chat) => {
            const phone =
                chat.id && chat.id.user
                    ? chat.id.user
                    : null;

            const lastTimestamp = chat.timestamp
                ? new Date(chat.timestamp * 1000).toISOString()
                : null;

            return {
                id: chat.id._serialized,
                name: chat.name || chat.formattedTitle,
                phone,
                last_message_at: lastTimestamp,
            };
        });

        return res.json({ conversations });
    } catch (e) {
        console.error('Error fetching conversations', e);
        return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// GET /conversations/:chatId/messages?session_ref=...&limit=50
app.get('/conversations/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const { session_ref, limit = 50 } = req.query;

    const state = sessions.get(session_ref);
    if (!state) {
        return res.status(400).json({ error: 'Unknown session_ref' });
    }

    try {
        const chat = await state.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: Number(limit) || 50 });

        const payload = messages.map((m) => ({
            id: m.id.id,
            direction: m.fromMe ? 'outbound' : 'inbound',
            body: m.body,
            sent_at: m.timestamp
                ? new Date(m.timestamp * 1000).toISOString()
                : null,
        }));

        return res.json({ messages: payload });
    } catch (e) {
        console.error('Error fetching messages', e);
        return res.status(500).json({ error: 'Failed to fetch messages' });
    }
});



// GET /sessions/status?session_ref=...
app.get('/sessions/status', (req, res) => {
    const { session_ref } = req.query;
    const state = sessions.get(session_ref);

    if (!state) {
        return res.status(400).json({ error: 'Unknown session_ref' });
    }

    const status = state.isReady ? 'connected' : 'waiting_for_qr';

    return res.json({
        session_ref,
        status,
    });
});

app.listen(PORT, () => {
    console.log(`WhatsApp Node service running on http://localhost:${PORT}`);
});