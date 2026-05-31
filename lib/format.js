function formatarPrata(valor) {
    return `${Math.floor(Number(valor) || 0).toLocaleString('pt-BR')} Pratas`;
}

function formatarData(iso) {
    if (!iso) return '—';
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return '—';
    return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

module.exports = { formatarPrata, formatarData };
