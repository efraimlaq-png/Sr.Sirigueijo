require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    AttachmentBuilder
} = require('discord.js');

const { processarMensagemRecibo } = require('./lib/receipts');
const { gerarPlanilhaSaldos } = require('./lib/excel');
const { formatarPrata, formatarData } = require('./lib/format');
const { STATUS_RESGATE, TIPOS_TRANSACAO } = require('./lib/constants');
const storage = require('./lib/storage');

const {
    DISCORD_TOKEN,
    CLIENT_ID,
    GUILD_ID,
    CANAL_RECIBOS_ID,
    CARGO_FINANCEIRO_ID,
    CANAL_RESGATES_ID
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('Defina DISCORD_TOKEN e CLIENT_ID no arquivo .env');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

function membroTemCargoFinanceiro(member) {
    return Boolean(CARGO_FINANCEIRO_ID && member?.roles?.cache?.has(CARGO_FINANCEIRO_ID));
}

function canalRecibosConfigurado() {
    return Boolean(CANAL_RECIBOS_ID);
}

async function enviarPlanilhaParaCargo(guild, motivo = 'Atualização de saldos') {
    if (!CARGO_FINANCEIRO_ID) return { enviados: 0, falhas: 0, motivo: 'cargo_nao_configurado' };

    const caminho = await gerarPlanilhaSaldos(guild);
    const arquivo = new AttachmentBuilder(caminho, { name: path.basename(caminho) });
    const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('📊 Planilha de Saldos')
        .setDescription(motivo)
        .setTimestamp();

    const cargo = guild.roles.cache.get(CARGO_FINANCEIRO_ID)
        || await guild.roles.fetch(CARGO_FINANCEIRO_ID).catch(() => null);
    if (!cargo) return { enviados: 0, falhas: 0, motivo: 'cargo_nao_encontrado' };

    await guild.members.fetch();
    const destinatarios = cargo.members.filter(m => !m.user.bot);
    let enviados = 0;
    let falhas = 0;

    for (const [, membro] of destinatarios) {
        try {
            await membro.send({ embeds: [embed], files: [arquivo] });
            enviados++;
        } catch {
            falhas++;
        }
    }

    return { enviados, falhas, caminho };
}

async function notificarCanalResgates(guild, embed, components = []) {
    if (!CANAL_RESGATES_ID) return null;
    const canal = guild.channels.cache.get(CANAL_RESGATES_ID)
        || await guild.channels.fetch(CANAL_RESGATES_ID).catch(() => null);
    if (!canal?.isTextBased?.()) return null;
    return canal.send({ embeds: [embed], components });
}

function botoesResgate(resgateId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`resgate_aprovar_${resgateId}`)
            .setLabel('Aprovar')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`resgate_recusar_${resgateId}`)
            .setLabel('Recusar')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`resgate_pagar_${resgateId}`)
            .setLabel('Confirmar pagamento')
            .setStyle(ButtonStyle.Primary)
    );
}

const comandos = [
    new SlashCommandBuilder()
        .setName('saldo')
        .setDescription('Consulta seu saldo acumulado de pratas'),

    new SlashCommandBuilder()
        .setName('resgatar')
        .setDescription('Solicita resgate do seu saldo')
        .addIntegerOption(opt =>
            opt.setName('valor')
                .setDescription('Quantidade de pratas a resgatar')
                .setRequired(true)
                .setMinValue(1))
        .addStringOption(opt =>
            opt.setName('observacao')
                .setDescription('Informação adicional (ex: chave PIX, personagem)')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Comandos administrativos de saldo e resgates')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('exportar-planilha')
                .setDescription('Gera planilha Excel e envia na DM do cargo financeiro'))
        .addSubcommand(sub =>
            sub.setName('sincronizar-recibos')
                .setDescription('Processa recibos antigos do canal de integração')
                .addIntegerOption(opt =>
                    opt.setName('limite')
                        .setDescription('Quantidade máxima de mensagens a verificar (padrão: 100)')
                        .setMinValue(1)
                        .setMaxValue(500)))
        .addSubcommand(sub =>
            sub.setName('consultar-saldo')
                .setDescription('Consulta saldo de um membro')
                .addUserOption(opt =>
                    opt.setName('membro').setDescription('Membro').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('adicionar-saldo')
                .setDescription('Adiciona saldo a um membro')
                .addUserOption(opt => opt.setName('membro').setDescription('Membro').setRequired(true))
                .addIntegerOption(opt => opt.setName('valor').setDescription('Valor em pratas').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste')))
        .addSubcommand(sub =>
            sub.setName('remover-saldo')
                .setDescription('Remove saldo de um membro')
                .addUserOption(opt => opt.setName('membro').setDescription('Membro').setRequired(true))
                .addIntegerOption(opt => opt.setName('valor').setDescription('Valor em pratas').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste')))
        .addSubcommand(sub =>
            sub.setName('definir-debito')
                .setDescription('Define um débito (saldo negativo) para o membro')
                .addUserOption(opt => opt.setName('membro').setDescription('Membro').setRequired(true))
                .addIntegerOption(opt => opt.setName('valor').setDescription('Valor do débito em pratas').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do débito')))
        .addSubcommand(sub =>
            sub.setName('resgates')
                .setDescription('Lista solicitações de resgate')
                .addStringOption(opt =>
                    opt.setName('status')
                        .setDescription('Filtrar por status')
                        .addChoices(
                            { name: 'Pendentes', value: STATUS_RESGATE.PENDENTE },
                            { name: 'Aprovados', value: STATUS_RESGATE.APROVADO },
                            { name: 'Pagos', value: STATUS_RESGATE.PAGO },
                            { name: 'Recusados', value: STATUS_RESGATE.RECUSADO }
                        )))
].map(c => c.toJSON());

async function registrarComandos() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    if (GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: comandos });
        console.log(`Comandos registrados na guild ${GUILD_ID}`);
    } else {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: comandos });
        console.log('Comandos registrados globalmente');
    }
}

async function processarReciboEMnotificar(message) {
    if (!canalRecibosConfigurado() || message.channelId !== CANAL_RECIBOS_ID) return;
    if (message.author?.id === client.user.id) return;

    const resultado = await processarMensagemRecibo(message, message.guild);
    if (!resultado.processado) return;

    console.log(`Recibo processado: ${resultado.resumo.eventoNome} (${resultado.resumo.tipo}) — ${resultado.creditosAplicados.length} crédito(s)`);

    try {
        await message.react('✅');
    } catch { /* ignore */ }

    const envio = await enviarPlanilhaParaCargo(
        message.guild,
        `Recibo processado: **${resultado.resumo.eventoNome}** (grupo ${resultado.resumo.grupoNum}, ${resultado.resumo.tipo}). Total creditado: **${formatarPrata(resultado.totalCreditado)}**.`
    );
    console.log(`Planilha enviada: ${envio.enviados} DM(s), ${envio.falhas} falha(s)`);
}

client.once('ready', async () => {
    console.log(`Bot conectado como ${client.user.tag}`);
    if (!canalRecibosConfigurado()) {
        console.warn('CANAL_RECIBOS_ID não configurado — o bot não vai ler recibos automaticamente.');
    }
    if (!CARGO_FINANCEIRO_ID) {
        console.warn('CARGO_FINANCEIRO_ID não configurado — planilhas não serão enviadas por DM.');
    }
});

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author?.bot) return;
    try {
        await processarReciboEMnotificar(message);
    } catch (error) {
        console.error('Erro ao processar recibo:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await tratarComando(interaction);
            return;
        }
        if (interaction.isButton()) {
            await tratarBotaoResgate(interaction);
        }
    } catch (error) {
        console.error('Erro na interação:', error);
        const msg = '❌ Ocorreu um erro ao processar sua solicitação.';
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
        } else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
        }
    }
});

async function tratarComando(interaction) {
    const { commandName } = interaction;

    if (commandName === 'saldo') {
        const saldo = storage.obterSaldoMembro(interaction.guildId, interaction.user.id);
        const pendentes = storage.listarResgates(interaction.guildId, STATUS_RESGATE.PENDENTE)
            .filter(r => r.userId === interaction.user.id);
        const aprovados = storage.listarResgates(interaction.guildId, STATUS_RESGATE.APROVADO)
            .filter(r => r.userId === interaction.user.id);
        const reservado = [...pendentes, ...aprovados].reduce((s, r) => s + r.valor, 0);

        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('💰 Seu saldo')
            .addFields(
                { name: 'Saldo disponível', value: formatarPrata(saldo), inline: true },
                { name: 'Em resgate (pendente/aprovado)', value: formatarPrata(reservado), inline: true },
                { name: 'Saldo livre estimado', value: formatarPrata(saldo - reservado), inline: true }
            )
            .setTimestamp();

        const ultimas = storage.listarTransacoesMembro(interaction.guildId, interaction.user.id, 5);
        if (ultimas.length) {
            embed.addFields({
                name: 'Últimas movimentações',
                value: ultimas.map(t => {
                    const sinal = t.amount >= 0 ? '+' : '';
                    return `\`${formatarData(t.createdAt)}\` ${sinal}${formatarPrata(t.amount)} — ${t.type}`;
                }).join('\n').slice(0, 1024)
            });
        }

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'resgatar') {
        const valor = interaction.options.getInteger('valor', true);
        const observacao = interaction.options.getString('observacao');
        const saldo = storage.obterSaldoMembro(interaction.guildId, interaction.user.id);

        const pendentes = storage.listarResgates(interaction.guildId)
            .filter(r => r.userId === interaction.user.id && [STATUS_RESGATE.PENDENTE, STATUS_RESGATE.APROVADO].includes(r.status));
        const reservado = pendentes.reduce((s, r) => s + r.valor, 0);
        const livre = saldo - reservado;

        if (valor > livre) {
            return interaction.reply({
                content: `❌ Saldo insuficiente. Disponível para resgate: **${formatarPrata(livre)}** (saldo total: ${formatarPrata(saldo)}).`,
                ephemeral: true
            });
        }

        const resgate = storage.criarResgate(interaction.guildId, interaction.user.id, valor, observacao);
        storage.registrarTransacao(interaction.guildId, {
            type: TIPOS_TRANSACAO.RESGATE_SOLICITADO,
            userId: interaction.user.id,
            amount: 0,
            resgateId: resgate.id,
            metadata: { valor, observacao }
        });

        const embed = new EmbedBuilder()
            .setColor('#f39c12')
            .setTitle('📤 Solicitação de resgate')
            .setDescription(`<@${interaction.user.id}> solicitou resgate de **${formatarPrata(valor)}**`)
            .addFields(
                { name: 'ID', value: `\`${resgate.id}\``, inline: true },
                { name: 'Status', value: 'Pendente', inline: true },
                { name: 'Observação', value: observacao || '—' }
            )
            .setTimestamp();

        await notificarCanalResgates(interaction.guild, embed, [botoesResgate(resgate.id)]);

        return interaction.reply({
            content: `✅ Resgate solicitado! ID: \`${resgate.id}\`. Valor: **${formatarPrata(valor)}**. Aguarde aprovação da equipe financeira.`,
            ephemeral: true
        });
    }

    if (commandName === 'admin') {
        if (!membroTemCargoFinanceiro(interaction.member)) {
            return interaction.reply({
                content: '❌ Você precisa do cargo financeiro configurado para usar comandos admin.',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'exportar-planilha') {
            await interaction.deferReply({ ephemeral: true });
            const envio = await enviarPlanilhaParaCargo(interaction.guild, 'Exportação manual solicitada por admin.');
            if (envio.motivo) {
                return interaction.editReply(`❌ Não foi possível enviar: ${envio.motivo}`);
            }
            return interaction.editReply(`✅ Planilha enviada para **${envio.enviados}** membro(s) do cargo financeiro (${envio.falhas} falha(s) de DM).`);
        }

        if (sub === 'sincronizar-recibos') {
            if (!canalRecibosConfigurado()) {
                return interaction.reply({ content: '❌ CANAL_RECIBOS_ID não está configurado no .env', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const limite = interaction.options.getInteger('limite') || 100;
            const canal = await interaction.guild.channels.fetch(CANAL_RECIBOS_ID);
            const mensagens = await canal.messages.fetch({ limit: limite });
            let processados = 0;
            let ignorados = 0;

            for (const [, msg] of mensagens) {
                const r = await processarMensagemRecibo(msg, interaction.guild);
                if (r.processado) processados++;
                else ignorados++;
            }

            if (processados > 0) {
                await enviarPlanilhaParaCargo(interaction.guild, `Sincronização concluída — ${processados} recibo(s) processado(s).`);
            }

            return interaction.editReply(`✅ Sincronização finalizada. Processados: **${processados}**, ignorados/já existentes: **${ignorados}**.`);
        }

        if (sub === 'consultar-saldo') {
            const membro = interaction.options.getUser('membro', true);
            const saldo = storage.obterSaldoMembro(interaction.guildId, membro.id);
            return interaction.reply({
                content: `💰 Saldo de <@${membro.id}>: **${formatarPrata(saldo)}**`,
                ephemeral: true
            });
        }

        if (sub === 'adicionar-saldo') {
            const membro = interaction.options.getUser('membro', true);
            const valor = interaction.options.getInteger('valor', true);
            const motivo = interaction.options.getString('motivo') || 'Ajuste manual';
            const antes = storage.obterSaldoMembro(interaction.guildId, membro.id);
            const guildMember = await interaction.guild.members.fetch(membro.id).catch(() => null);
            storage.ajustarSaldo(interaction.guildId, membro.id, valor, guildMember?.displayName);
            const depois = storage.obterSaldoMembro(interaction.guildId, membro.id);
            storage.registrarTransacao(interaction.guildId, {
                type: TIPOS_TRANSACAO.AJUSTE_ADICIONAR,
                userId: membro.id,
                amount: valor,
                balanceBefore: antes,
                balanceAfter: depois,
                adminId: interaction.user.id,
                metadata: { motivo }
            });
            return interaction.reply({
                content: `✅ Adicionado **${formatarPrata(valor)}** para <@${membro.id}>. Novo saldo: **${formatarPrata(depois)}**`,
                ephemeral: true
            });
        }

        if (sub === 'remover-saldo') {
            const membro = interaction.options.getUser('membro', true);
            const valor = interaction.options.getInteger('valor', true);
            const motivo = interaction.options.getString('motivo') || 'Ajuste manual';
            const antes = storage.obterSaldoMembro(interaction.guildId, membro.id);
            storage.ajustarSaldo(interaction.guildId, membro.id, -valor);
            const depois = storage.obterSaldoMembro(interaction.guildId, membro.id);
            storage.registrarTransacao(interaction.guildId, {
                type: TIPOS_TRANSACAO.AJUSTE_REMOVER,
                userId: membro.id,
                amount: -valor,
                balanceBefore: antes,
                balanceAfter: depois,
                adminId: interaction.user.id,
                metadata: { motivo }
            });
            return interaction.reply({
                content: `✅ Removido **${formatarPrata(valor)}** de <@${membro.id}>. Novo saldo: **${formatarPrata(depois)}**`,
                ephemeral: true
            });
        }

        if (sub === 'definir-debito') {
            const membro = interaction.options.getUser('membro', true);
            const valor = interaction.options.getInteger('valor', true);
            const motivo = interaction.options.getString('motivo') || 'Débito manual';
            const antes = storage.obterSaldoMembro(interaction.guildId, membro.id);
            storage.definirSaldoMembro(interaction.guildId, membro.id, -Math.abs(valor));
            const depois = storage.obterSaldoMembro(interaction.guildId, membro.id);
            storage.registrarTransacao(interaction.guildId, {
                type: TIPOS_TRANSACAO.AJUSTE_DEBITO,
                userId: membro.id,
                amount: depois - antes,
                balanceBefore: antes,
                balanceAfter: depois,
                adminId: interaction.user.id,
                metadata: { motivo, debitoDefinido: valor }
            });
            return interaction.reply({
                content: `✅ Débito definido para <@${membro.id}>: **${formatarPrata(depois)}**`,
                ephemeral: true
            });
        }

        if (sub === 'resgates') {
            const status = interaction.options.getString('status') || STATUS_RESGATE.PENDENTE;
            const lista = storage.listarResgates(interaction.guildId, status).slice(0, 15);
            if (!lista.length) {
                return interaction.reply({ content: `Nenhum resgate com status **${status}**.`, ephemeral: true });
            }
            const texto = lista.map(r =>
                `\`${r.id}\` <@${r.userId}> — **${formatarPrata(r.valor)}** (${r.status}) ${r.observacao ? `— ${r.observacao}` : ''}`
            ).join('\n');
            return interaction.reply({ content: `📋 Resgates (${status}):\n${texto}`, ephemeral: true });
        }
    }
}

async function tratarBotaoResgate(interaction) {
    if (!membroTemCargoFinanceiro(interaction.member)) {
        return interaction.reply({ content: '❌ Apenas o cargo financeiro pode gerenciar resgates.', ephemeral: true });
    }

    const match = interaction.customId.match(/^resgate_(aprovar|recusar|pagar)_(.+)$/);
    if (!match) return;

    const acaoResgate = match[1];
    const idResgate = match[2];

    const resgate = storage.obterResgate(interaction.guildId, idResgate);
    if (!resgate) {
        return interaction.reply({ content: '❌ Resgate não encontrado.', ephemeral: true });
    }

    if (acaoResgate === 'aprovar') {
        if (resgate.status !== STATUS_RESGATE.PENDENTE) {
            return interaction.reply({ content: `❌ Resgate já está **${resgate.status}**.`, ephemeral: true });
        }
        storage.atualizarResgate(interaction.guildId, idResgate, {
            status: STATUS_RESGATE.APROVADO,
            approvedAt: new Date().toISOString(),
            approvedById: interaction.user.id
        });
        try {
            const membro = await interaction.guild.members.fetch(resgate.userId);
            await membro.send(`✅ Seu resgate \`${idResgate}\` de **${formatarPrata(resgate.valor)}** foi **aprovado**. Aguarde a confirmação de pagamento.`);
        } catch { /* dm fechada */ }
        return interaction.update({
            embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#27ae60').setFooter({ text: `Aprovado por ${interaction.user.tag}` })],
            components: [botoesResgate(idResgate)]
        });
    }

    if (acaoResgate === 'recusar') {
        if ([STATUS_RESGATE.PAGO, STATUS_RESGATE.RECUSADO].includes(resgate.status)) {
            return interaction.reply({ content: `❌ Resgate já está **${resgate.status}**.`, ephemeral: true });
        }
        storage.atualizarResgate(interaction.guildId, idResgate, {
            status: STATUS_RESGATE.RECUSADO,
            rejectedAt: new Date().toISOString(),
            rejectedById: interaction.user.id
        });
        storage.registrarTransacao(interaction.guildId, {
            type: TIPOS_TRANSACAO.RESGATE_RECUSADO,
            userId: resgate.userId,
            amount: 0,
            resgateId: idResgate,
            adminId: interaction.user.id
        });
        try {
            const membro = await interaction.guild.members.fetch(resgate.userId);
            await membro.send(`❌ Seu resgate \`${idResgate}\` de **${formatarPrata(resgate.valor)}** foi **recusado**.`);
        } catch { /* dm fechada */ }
        return interaction.update({
            embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#c0392b').setFooter({ text: `Recusado por ${interaction.user.tag}` })],
            components: []
        });
    }

    if (acaoResgate === 'pagar') {
        if (![STATUS_RESGATE.PENDENTE, STATUS_RESGATE.APROVADO].includes(resgate.status)) {
            return interaction.reply({ content: `❌ Resgate não pode ser pago (status: **${resgate.status}**).`, ephemeral: true });
        }
        const saldo = storage.obterSaldoMembro(interaction.guildId, resgate.userId);
        if (saldo < resgate.valor) {
            return interaction.reply({
                content: `❌ Saldo insuficiente do membro (${formatarPrata(saldo)}).`,
                ephemeral: true
            });
        }
        const antes = saldo;
        storage.ajustarSaldo(interaction.guildId, resgate.userId, -resgate.valor);
        const depois = storage.obterSaldoMembro(interaction.guildId, resgate.userId);
        storage.atualizarResgate(interaction.guildId, idResgate, {
            status: STATUS_RESGATE.PAGO,
            paidAt: new Date().toISOString(),
            paidById: interaction.user.id,
            approvedAt: resgate.approvedAt || new Date().toISOString(),
            approvedById: resgate.approvedById || interaction.user.id
        });
        storage.registrarTransacao(interaction.guildId, {
            type: TIPOS_TRANSACAO.RESGATE_PAGO,
            userId: resgate.userId,
            amount: -resgate.valor,
            balanceBefore: antes,
            balanceAfter: depois,
            resgateId: idResgate,
            adminId: interaction.user.id
        });
        try {
            const membro = await interaction.guild.members.fetch(resgate.userId);
            await membro.send(`💸 Pagamento confirmado! Resgate \`${idResgate}\` de **${formatarPrata(resgate.valor)}** foi processado. Saldo restante: **${formatarPrata(depois)}**.`);
        } catch { /* dm fechada */ }
        await enviarPlanilhaParaCargo(interaction.guild, `Pagamento de resgate \`${idResgate}\` confirmado por ${interaction.user.tag}.`);
        return interaction.update({
            embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#8e44ad').setFooter({ text: `Pago por ${interaction.user.tag}` })],
            components: []
        });
    }
}

async function iniciar() {
    await registrarComandos();
    await client.login(DISCORD_TOKEN);
}

iniciar().catch(error => {
    console.error('Falha ao iniciar bot:', error);
    process.exit(1);
});
