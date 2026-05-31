const {
    RECIBO_INTEGRACAO_SCHEMA,
    RECIBO_INTEGRACAO_MARCADOR,
    TIPOS_TRANSACAO
} = require('./constants');
const {
    ajustarSaldo,
    registrarTransacao,
    creditoEventoJaRegistrado,
    reciboJaProcessado,
    marcarReciboProcessado
} = require('./storage');

function mensagemEhReciboIntegracao(message) {
    const conteudo = message.content || '';
    return conteudo.includes(RECIBO_INTEGRACAO_MARCADOR) && conteudo.includes(RECIBO_INTEGRACAO_SCHEMA);
}

function obterAnexoJsonRecibo(message) {
    return message.attachments.find(a =>
        a.name?.endsWith('.json') ||
        a.contentType === 'application/json' ||
        a.contentType === 'text/json'
    ) || null;
}

async function baixarPayloadRecibo(anexo) {
    const resposta = await fetch(anexo.url);
    if (!resposta.ok) throw new Error(`Falha ao baixar anexo: ${resposta.status}`);
    return resposta.json();
}

function validarPayload(payload) {
    if (!payload || typeof payload !== 'object') return { valido: false, motivo: 'payload_invalido' };
    if (payload.marker !== RECIBO_INTEGRACAO_MARCADOR) return { valido: false, motivo: 'marcador_invalido' };
    if (payload.schema !== RECIBO_INTEGRACAO_SCHEMA) return { valido: false, motivo: 'schema_invalido' };
    if (!payload.event?.id) return { valido: false, motivo: 'evento_ausente' };
    return { valido: true };
}

function extrairCreditosDoRecibo(payload) {
    const eventoId = payload.event.id;
    const grupoNum = payload.group?.number ?? (payload.group?.index ?? 0) + 1;
    const tipo = payload.eventType || 'desconhecido';
    const creditos = [];

    if (tipo === 'split_sacolas' || tipo === 'pagamento_sacola') {
        for (const entry of payload.bags?.entries || []) {
            if (!entry.userId || !entry.amount) continue;
            if (tipo === 'pagamento_sacola' && entry.paid === false) continue;
            creditos.push({
                userId: entry.userId,
                amount: Math.floor(Number(entry.amount) || 0),
                role: entry.role || null,
                weapon: entry.weapon || null,
                fonte: 'bags',
                creditKey: `${eventoId}:g${grupoNum}:${tipo}:${entry.userId}`
            });
        }
    }

    if (tipo === 'split_bau') {
        for (const entry of payload.chest?.split || []) {
            if (!entry.userId || !entry.amount) continue;
            creditos.push({
                userId: entry.userId,
                amount: Math.floor(Number(entry.amount) || 0),
                fonte: 'chest',
                creditKey: `${eventoId}:g${grupoNum}:${tipo}:${entry.userId}`
            });
        }
    }

    return {
        eventoId,
        eventoNome: payload.event.name || eventoId,
        grupoNum,
        tipo,
        creditos: creditos.filter(c => c.amount !== 0)
    };
}

async function processarMensagemRecibo(message, guild) {
    if (!mensagemEhReciboIntegracao(message)) return { processado: false, motivo: 'nao_e_recibo' };
    if (reciboJaProcessado(message.id)) return { processado: false, motivo: 'ja_processado' };

    const anexo = obterAnexoJsonRecibo(message);
    if (!anexo) return { processado: false, motivo: 'sem_anexo_json' };

    let payload;
    try {
        payload = await baixarPayloadRecibo(anexo);
    } catch (error) {
        return { processado: false, motivo: 'falha_download', erro: error.message };
    }

    const validacao = validarPayload(payload);
    if (!validacao.valido) return { processado: false, motivo: validacao.motivo };

    const guildId = guild.id;
    const resumo = extrairCreditosDoRecibo(payload);
    const creditosAplicados = [];

    for (const credito of resumo.creditos) {
        if (creditoEventoJaRegistrado(guildId, credito.creditKey)) continue;

        let displayName = credito.userId;
        try {
            const membro = await guild.members.fetch(credito.userId);
            displayName = membro.displayName || membro.user.username;
        } catch { /* membro pode ter saído */ }

        const saldoAnterior = require('./storage').obterSaldoMembro(guildId, credito.userId);
        ajustarSaldo(guildId, credito.userId, credito.amount, displayName);
        registrarTransacao(guildId, {
            type: TIPOS_TRANSACAO.CREDITO_EVENTO,
            userId: credito.userId,
            amount: credito.amount,
            balanceBefore: saldoAnterior,
            balanceAfter: saldoAnterior + credito.amount,
            creditKey: credito.creditKey,
            eventId: resumo.eventoId,
            eventName: resumo.eventoNome,
            groupNumber: resumo.grupoNum,
            eventType: resumo.tipo,
            source: credito.fonte,
            receiptMessageId: message.id,
            metadata: { role: credito.role, weapon: credito.weapon }
        });
        creditosAplicados.push(credito);
    }

    marcarReciboProcessado(message.id, {
        eventId: resumo.eventoId,
        eventType: resumo.tipo,
        creditsApplied: creditosAplicados.length
    });

    return {
        processado: true,
        resumo,
        creditosAplicados,
        totalCreditado: creditosAplicados.reduce((s, c) => s + c.amount, 0)
    };
}

module.exports = {
    mensagemEhReciboIntegracao,
    processarMensagemRecibo
};
