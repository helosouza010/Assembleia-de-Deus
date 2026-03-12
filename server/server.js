/* eslint-disable no-console */
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const crypto = require('crypto');
const path = require('path');

const db = require('./db');

dotenv.config();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret';

const TEST_USERS = (process.env.TEST_USERS || '').split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [email, password] = entry.split(':');
    return { email: email?.trim(), password: password?.trim() };
  });

// Registra usuários de teste na base ao iniciar
(function seedTestUsers() {
  const usersToSeed = TEST_USERS.map((user) => ({
    provider: 'local',
    provider_id: user.email,
    email: user.email,
    name: user.email,
    password: hashPassword(user.password),
  }));

  db.ensureUsers(usersToSeed);
})();

function findUserByEmail(email) {
  return db.findUserByEmail(email);
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createTransporter() {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Valida a conexão com o SMTP ao iniciar
  await transporter.verify();
  return transporter;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function isValidPassword(user, password) {
  if (!user || !user.password) return false;
  return hashPassword(password) === user.password;
}

function hasEnvValue(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().toLowerCase() !== 'undefined' &&
    value.trim().toLowerCase() !== 'null'
  );
}

function ensureAuthenticated(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  next();
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 15, // 15 minutos
      httpOnly: true,
    },
  })
);

// Servir arquivos estáticos (HTML / CSS) a partir da raiz do projeto
app.use(express.static(path.join(__dirname, '..')));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, { id: user.id, email: user.email, name: user.name });
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

if (hasEnvValue(process.env.GOOGLE_CLIENT_ID) && hasEnvValue(process.env.GOOGLE_CLIENT_SECRET)) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const provider = 'google';
          const providerId = profile.id;
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;

          let user = db.findUserByProvider(provider, providerId);
          if (!user) {
            user = db.createUser({ provider, providerId, email, name });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  console.warn('Google OAuth não configurado (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes)');
}

if (hasEnvValue(process.env.FACEBOOK_APP_ID) && hasEnvValue(process.env.FACEBOOK_APP_SECRET)) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL || 'http://localhost:3000/auth/facebook/callback',
        profileFields: ['id', 'displayName', 'emails'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const provider = 'facebook';
          const providerId = profile.id;
          const email = profile.emails?.[0]?.value || `${profile.id}@facebook`;
          const name = profile.displayName;

          let user = db.findUserByProvider(provider, providerId);
          if (!user) {
            user = db.createUser({ provider, providerId, email, name });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  console.warn('Facebook OAuth não configurado (FACEBOOK_APP_ID/FACEBOOK_APP_SECRET ausentes)');
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/send-code', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }

  const user = findUserByEmail(email);
  if (!user || !isValidPassword(user, password)) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const code = generateCode();
  req.session.twoFactorCode = code;
  req.session.authenticatedEmail = email;
  req.session.codeCreatedAt = Date.now();

  try {
    const transporter = await createTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Seu código de verificação - AD Jardim Ponta Grossa',
      text: `Seu código de verificação é: ${code}`,
      html: `<p>Seu código de verificação é: <strong>${code}</strong></p>`,
    });

    return res.json({ message: 'Código de verificação enviado por e-mail.' });
  } catch (error) {
    console.warn('Falha ao enviar e-mail de verificação:', error);
    return res.status(500).json({ error: 'Não foi possível enviar o código por e-mail.' });
  }
});

app.post('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ message: 'Logout realizado.' });
    });
  });
});

app.get('/api/profile', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  return res.json({
    email: req.user.email,
    name: req.user.name,
    provider: req.user.provider,
  });
});

if (hasEnvValue(process.env.GOOGLE_CLIENT_ID) && hasEnvValue(process.env.GOOGLE_CLIENT_SECRET)) {
  app.get('/auth/google', passport.authenticate('google', { scope: ['email', 'profile'] }));

  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?login=failed' }),
    (req, res) => {
      res.redirect('/?login=success&provider=google');
    }
  );
} else {
  app.get('/auth/google', (req, res) => {
    res.status(501).send('Google OAuth não configurado. Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.');
  });

  app.get('/auth/google/callback', (req, res) => {
    res.status(501).send('Google OAuth não configurado.');
  });
}

if (hasEnvValue(process.env.FACEBOOK_APP_ID) && hasEnvValue(process.env.FACEBOOK_APP_SECRET)) {
  app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));

  app.get(
    '/auth/facebook/callback',
    passport.authenticate('facebook', { failureRedirect: '/?login=failed' }),
    (req, res) => {
      res.redirect('/?login=success&provider=facebook');
    }
  );
} else {
  app.get('/auth/facebook', (req, res) => {
    res.status(501).send('Facebook OAuth não configurado. Configure FACEBOOK_APP_ID e FACEBOOK_APP_SECRET.');
  });

  app.get('/auth/facebook/callback', (req, res) => {
    res.status(501).send('Facebook OAuth não configurado.');
  });
}


app.post('/api/verify-code', (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ error: 'O código é obrigatório.' });
  }

  const storedCode = req.session?.twoFactorCode;
  const createdAt = req.session?.codeCreatedAt;

  if (!storedCode || !createdAt) {
    return res.status(401).json({ error: 'Nenhum código foi gerado. Faça login novamente.' });
  }

  const expired = Date.now() - createdAt > 1000 * 60 * 10; // 10 minutos
  if (expired) {
    req.session.twoFactorCode = null;
    return res.status(401).json({ error: 'O código expirou. Solicite um novo código.' });
  }

  if (code.trim() !== storedCode) {
    return res.status(401).json({ error: 'Código inválido.' });
  }

  const email = req.session.authenticatedEmail;
  const user = findUserByEmail(email);

  // Marca como autenticado (local) e também inicializa Passport
  req.session.isAuthenticated = true;
  req.login(user, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Falha ao autenticar sessão.' });
    }

    delete req.session.twoFactorCode;
    delete req.session.codeCreatedAt;
    return res.json({ message: 'Autenticado com sucesso.' });
  });
});

app.post('/api/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ message: 'Logout realizado.' });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Servidor de autenticação rodando em http://localhost:${PORT}`);
  console.log('Lembre-se de criar .env a partir de .env.example e configurar SMTP.');
});
