# Automação Minha Usina — ponte Gmail → sistema

Estes scripts fazem a ponte entre o e-mail e o sistema. Eles rodam fora do
aplicativo (na rotina diária do assistente), lêem as faturas que chegam por
e-mail e enviam os dados para as rotas `/api/import-pending` e
`/api/import-expense` do aplicativo.

Nenhum destes arquivos contém senha ou segredo. O segredo
`PENDING_IMPORT_SECRET` fica guardado no cofre do assistente e no Lovable
Secrets, e é enviado no header `x-import-secret` de cada chamada.

## Arquivos

- `ingest.py` — rotina principal. Lê o Gmail, baixa os PDFs e envia tudo.
  Uso: `python3 ingest.py --dry-run` (só lê, não envia) ou
  `python3 ingest.py` (envia de verdade).
- `parse_fatura.py` — extrai os campos de uma fatura da Equatorial Energia
  (UC, referência, consumo, preço do kW, iluminação pública, juros/multa,
  valor da fatura e vencimento).
- `parse_demae.py` — extrai os campos de uma fatura de água do Demae
  (matrícula, referência, vencimento e valor total).

## O que a rotina faz

- **Faturas dos clientes (Equatorial):** cada PDF vira uma importação
  pendente no sistema. O avatar do cliente passa a pulsar em Faturas e o
  lançamento abre já preenchido. Faturas já lançadas ou já pendentes são
  ignoradas.
- **Energia da usina:** a fatura da UC geradora (423837601225) vira a
  despesa "Fatura de Energia Usina" (categoria Fatura Usina, pendente),
  com o valor total da fatura.
- **Água (Demae):** só a matrícula 59289-7 é da usina e vira a despesa
  "Fatura de Agua Usina". Outras matrículas no nome do usuário (outros
  imóveis) são ignoradas.
- **Internet:** despesa fixa "Fatura de Internet Usina" de R$ 79,00. A do
  mês M é lançada no dia 25 do mês M-1; a rotina também garante a do mês
  corrente.
- As despesas entram direto como pendentes, sem revisão. A conferência de
  duplicata é por categoria + descrição + mês.

## De onde vêm os e-mails

- Regra no Outlook: de `atendimento@equatorialenergia.com.br`, assunto com
  "Fatura da Equatorial Energia" → redirecionar para o Gmail.
- Regra no Outlook: de `caldasnovas.fatura@sansys.app`, assunto com
  "Sua Fatura de Agua" → redirecionar para o Gmail.
- Filtro no Gmail: de `johnnathanmendonca@hotmail.com`, assunto
  "Fatura da Equatorial Energia" → nunca enviar para o spam.
- A rotina procura também no spam, então nada se perde se um
  encaminhamento cair lá.

## Para rodar em outro lugar

- Python 3 com `pdftotext` instalado (pacote poppler-utils).
- Acesso à API do Gmail (conta johnnathanmendonca92@gmail.com) para ler
  as mensagens e baixar os anexos.
- O segredo `PENDING_IMPORT_SECRET` (o mesmo cadastrado no Lovable
  Secrets) enviado no header `x-import-secret`.
- Os caminhos do Gmail CLI e do cofre de credenciais neste código são
  específicos do ambiente do assistente e precisam ser adaptados.
