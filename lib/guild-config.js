const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'guild-config.json');

const PLACEHOLDERS_ENV = /^id_do_/i;

function garantirDiretorio() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function lerJson(caminho, padrao) {
    garantirDiretorio();
    if (!fs.existsSync(caminho)) return structuredClone(padrao);
    try {
        return JSON.parse(fs.readFileSync(caminho, 'utf8'));
    } catch {
        return structuredClone(padrao);
    }
}

function salvarJson(caminho, dados) {
    garantirDiretorio();
    fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf8');
}

function envSnowflake(nome) {
    const valor = process.env[nome];
    if (!valor || PLACEHOLDERS_ENV.test(valor) || !/^\d{17,20}$/.test(valor)) return null;
    return valor;
}

function obter(guildId) {
    const dados = lerJson(CONFIG_PATH, {});
    const cfg = dados[guildId] || {};
    return {
        canalRecibosId: cfg.canalRecibosId || envSnowflake('CANAL_RECIBOS_ID') || null,
        cargoFinanceiroId: cfg.cargoFinanceiroId || envSnowflake('CARGO_FINANCEIRO_ID') || null,
        canalResgatesId: cfg.canalResgatesId || envSnowflake('CANAL_RESGATES_ID') || null,
        updatedAt: cfg.updatedAt || null,
        updatedById: cfg.updatedById || null
    };
}

function salvarCampo(guildId, patch, userId) {
    const dados = lerJson(CONFIG_PATH, {});
    if (!dados[guildId]) dados[guildId] = {};
    Object.assign(dados[guildId], patch, {
        updatedAt: new Date().toISOString(),
        updatedById: userId
    });
    salvarJson(CONFIG_PATH, dados);
    return obter(guildId);
}

function definirCanalRecibos(guildId, channelId, userId) {
    return salvarCampo(guildId, { canalRecibosId: channelId }, userId);
}

function definirCargoFinanceiro(guildId, roleId, userId) {
    return salvarCampo(guildId, { cargoFinanceiroId: roleId }, userId);
}

function definirCanalResgates(guildId, channelId, userId) {
    return salvarCampo(guildId, { canalResgatesId: channelId }, userId);
}

function limparCampo(guildId, campo, userId) {
    const dados = lerJson(CONFIG_PATH, {});
    if (!dados[guildId]) return obter(guildId);
    delete dados[guildId][campo];
    dados[guildId].updatedAt = new Date().toISOString();
    dados[guildId].updatedById = userId;
    salvarJson(CONFIG_PATH, dados);
    return obter(guildId);
}

module.exports = {
    obter,
    definirCanalRecibos,
    definirCargoFinanceiro,
    definirCanalResgates,
    limparCampo
};
