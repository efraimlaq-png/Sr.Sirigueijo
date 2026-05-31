const RECIBO_INTEGRACAO_SCHEMA = 'flg-lfg-receipt/v1';
const RECIBO_INTEGRACAO_MARCADOR = 'FLG_RECEIPT';

const STATUS_RESGATE = {
    PENDENTE: 'pendente',
    APROVADO: 'aprovado',
    PAGO: 'pago',
    RECUSADO: 'recusado',
    CANCELADO: 'cancelado'
};

const TIPOS_TRANSACAO = {
    CREDITO_EVENTO: 'credito_evento',
    RESGATE_SOLICITADO: 'resgate_solicitado',
    RESGATE_PAGO: 'resgate_pago',
    RESGATE_RECUSADO: 'resgate_recusado',
    AJUSTE_ADICIONAR: 'ajuste_adicionar',
    AJUSTE_REMOVER: 'ajuste_remover',
    AJUSTE_DEBITO: 'ajuste_debito'
};

module.exports = {
    RECIBO_INTEGRACAO_SCHEMA,
    RECIBO_INTEGRACAO_MARCADOR,
    STATUS_RESGATE,
    TIPOS_TRANSACAO
};
