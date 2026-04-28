require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const app = express();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminSetupToken = process.env.ADMIN_SETUP_TOKEN;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
  : null;

app.use(cors()); // ⭐ IMPORTANT
app.use(express.json());

const getUserIdFromRequest = (req) => {
  const raw = req.headers['x-user-id'];
  if (!raw) return null;
  return Number(raw);
};

const getUserById = async (userId) => {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
};

const requireSupabase = (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({
      error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
  }
  return next();
};

const requireAdmin = async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: 'Missing x-user-id header.' });
    const user = await getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});

app.post('/contact', requireSupabase, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).send('Name, email, and message are required.');
    }

    const { error } = await supabase
      .from('contact_messages')
      .insert({ name, email, message });
    if (error) throw error;

    return res.send('Message received successfully!');
  } catch (error) {
    return res.status(500).send('Failed to save message.');
  }
});

app.post('/auth/admin/setup', requireSupabase, async (req, res) => {
  try {
    const { name, email, password, setupToken } = req.body;
    if (!adminSetupToken) {
      return res.status(500).json({ error: 'ADMIN_SETUP_TOKEN is not configured.' });
    }
    if (!setupToken || setupToken !== adminSetupToken) {
      return res.status(401).json({ error: 'Invalid setup token.' });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required.' });
    }

    const { data: existingAdmin, error: adminError } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .limit(1);
    if (adminError) throw adminError;
    if (existingAdmin && existingAdmin.length > 0) {
      return res.status(409).json({ error: 'Admin already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert({ name, email, role: 'admin', password_hash: passwordHash })
      .select('id, name, email, role')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', requireSupabase, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, password_hash')
      .eq('email', email)
      .single();
    if (error) return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, data.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    return res.json({ id: data.id, name: data.name, email: data.email, role: data.role });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/permissions', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('permissions')
      .select('id, key, description')
      .order('id', { ascending: true });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/users', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role')
      .order('id', { ascending: true });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/users/:id/permissions', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { data, error } = await supabase
      .from('user_permissions')
      .select('permission_id, permissions (id, key, description)')
      .eq('user_id', userId)
      .order('permission_id', { ascending: true });
    if (error) throw error;
    return res.json(data.map((row) => row.permissions));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/users/:id/permissions', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
      return res.status(400).json({ error: 'permissionIds array is required.' });
    }

    const rows = permissionIds.map((permissionId) => ({
      user_id: userId,
      permission_id: permissionId,
    }));

    const { error } = await supabase.from('user_permissions').upsert(rows, {
      onConflict: 'user_id,permission_id',
      ignoreDuplicates: true,
    });
    if (error) throw error;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/users/:id/permissions/:permId', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const permId = Number(req.params.permId);
    const { error } = await supabase
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('permission_id', permId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/me/permissions', requireSupabase, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: 'Missing x-user-id header.' });
    const { data, error } = await supabase
      .from('user_permissions')
      .select('permission_id, permissions (id, key, description)')
      .eq('user_id', userId)
      .order('permission_id', { ascending: true });
    if (error) throw error;
    return res.json(data.map((row) => row.permissions));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});