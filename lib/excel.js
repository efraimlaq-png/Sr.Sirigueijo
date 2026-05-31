const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { listarSaldosGuild } = require('./storage');
const { formatarPrata } = require('./format');

const EXPORT_DIR = path.join(__dirname, '..', 'data', 'exports');

async function gerarPlanilhaSaldos(guild) {
    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

    const saldos = listarSaldosGuild(guild.id);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SrSirigueijo Bot';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Saldos');
    sheet.columns = [
        { header: 'Usuário ID', key: 'userId', width: 22 },
        { header: 'Nome', key: 'displayName', width: 28 },
        { header: 'Saldo (Pratas)', key: 'balance', width: 18 },
        { header: 'Saldo formatado', key: 'balanceFmt', width: 22 },
        { header: 'Atualizado em', key: 'updatedAt', width: 22 }
    ];
    sheet.getRow(1).font = { bold: true };

    for (const item of saldos.sort((a, b) => b.balance - a.balance)) {
        let nome = item.displayName || item.userId;
        try {
            const membro = await guild.members.fetch(item.userId).catch(() => null);
            if (membro) nome = membro.displayName || membro.user.username;
        } catch { /* ignore */ }

        sheet.addRow({
            userId: item.userId,
            displayName: nome,
            balance: item.balance,
            balanceFmt: formatarPrata(item.balance),
            updatedAt: item.updatedAt || ''
        });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const nomeArquivo = `saldos-${guild.id}-${timestamp}.xlsx`;
    const caminho = path.join(EXPORT_DIR, nomeArquivo);
    await workbook.xlsx.writeFile(caminho);
    return caminho;
}

module.exports = { gerarPlanilhaSaldos };
