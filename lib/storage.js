const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BALANCES_PATH = path.join(DATA_DIR, 'balances.json');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');
const RESGATES_PATH = path.join(DATA_DIR, 'resgates.json');
const PROCESSED_PATH = path.join(DATA_DIR, 'processed-receipts.json');

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

function obterSaldoMembro(guildId, userId) {
    const dados = lerJson(BALANCES_PATH, {});
    return dados[guildId]?.[userId]?.balance ?? 0;
}

function obterMembro(guildId, userId) {
    const dados = lerJson(BALANCES_PATH, {});
    return dados[guildId]?.[userId] || { balance: 0, displayName: null, updatedAt: null };
}

function listarSaldosGuild(guildId) {
    const dados = lerJson(BALANCES_PATH, {});
    return Object.entries(dados[guildId] || {}).map(([userId, info]) => ({
        userId,
        balance: info.balance ?? 0,
        displayName: info.displayName || null,
        updatedAt: info.updatedAt || null
    }));
}

function definirSaldoMembro(guildId, userId, novoSaldo, displayName = null) {
    const dados = lerJson(BALANCES_PATH, {});
    if (!dados[guildId]) dados[guildId] = {};
    dados[guildId][userId] = {
        balance: Math.floor(Number(novoSaldo) || 0),
        displayName: displayName ?? dados[guildId][userId]?.displayName ?? null,
        updatedAt: new Date().toISOString()
    };
    salvarJson(BALANCES_PATH, dados);
    return dados[guildId][userId];
}

function ajustarSaldo(guildId, userId, delta, displayName = null) {
    const atual = obterSaldoMembro(guildId, userId);
    return definirSaldoMembro(guildId, userId, atual + Math.floor(Number(delta) || 0), displayName);
}

function registrarTransacao(guildId, transacao) {
    const dados = lerJson(TRANSACTIONS_PATH, {});
    if (!dados[guildId]) dados[guildId] = [];
    const registro = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        ...transacao
    };
    dados[guildId].unshift(registro);
    if (dados[guildId].length > 5000) dados[guildId].length = 5000;
    salvarJson(TRANSACTIONS_PATH, dados);
    return registro;
}

function listarTransacoesMembro(guildId, userId, limite = 10) {
    const dados = lerJson(TRANSACTIONS_PATH, {});
    return (dados[guildId] || [])
        .filter(t => t.userId === userId)
        .slice(0, limite);
}

function reciboJaProcessado(messageId) {
    const dados = lerJson(PROCESSED_PATH, {});
    return Boolean(dados[messageId]);
}

function marcarReciboProcessado(messageId, meta = {}) {
    const dados = lerJson(PROCESSED_PATH, {});
    dados[messageId] = { processedAt: new Date().toISOString(), ...meta };
    salvarJson(PROCESSED_PATH, dados);
}

function creditoEventoJaRegistrado(guildId, chaveCredito) {
    const dados = lerJson(TRANSACTIONS_PATH, {});
    return (dados[guildId] || []).some(t => t.creditKey === chaveCredito);
}

function criarResgate(guildId, userId, valor, observacao = null) {
    const dados = lerJson(RESGATES_PATH, {});
    if (!dados[guildId]) dados[guildId] = [];
    const resgate = {
        id: randomUUID().slice(0, 8),
        userId,
        valor: Math.floor(Number(valor) || 0),
        observacao,
        status: 'pendente',
        createdAt: new Date().toISOString(),
        approvedAt: null,
        approvedById: null,
        paidAt: null,
        paidById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectReason: null
    };
    dados[guildId].unshift(resgate);
    salvarJson(RESGATES_PATH, dados);
    return resgate;
}

function obterResgate(guildId, resgateId) {
    const dados = lerJson(RESGATES_PATH, {});
    return (dados[guildId] || []).find(r => r.id === resgateId) || null;
}

function atualizarResgate(guildId, resgateId, patch) {
    const dados = lerJson(RESGATES_PATH, {});
    const lista = dados[guildId] || [];
    const index = lista.findIndex(r => r.id === resgateId);
    if (index === -1) return null;
    lista[index] = { ...lista[index], ...patch };
    salvarJson(RESGATES_PATH, dados);
    return lista[index];
}

function listarResgates(guildId, status = null) {
    const dados = lerJson(RESGATES_PATH, {});
    let lista = dados[guildId] || [];
    if (status) lista = lista.filter(r => r.status === status);
    return lista;
}

module.exports = {
    obterSaldoMembro,
    obterMembro,
    listarSaldosGuild,
    definirSaldoMembro,
    ajustarSaldo,
    registrarTransacao,
    listarTransacoesMembro,
    reciboJaProcessado,
    marcarReciboProcessado,
    creditoEventoJaRegistrado,
    criarResgate,
    obterResgate,
    atualizarResgate,
    listarResgates
};
