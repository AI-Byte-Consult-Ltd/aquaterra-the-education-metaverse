import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const hook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1, config: { name: 'Heritage Request', parameters: {
  httpMethod: 'POST', path: 'aquaterra-heritage', authentication: 'none', responseMode: 'responseNode',
  options: { allowedOrigins: 'https://aquaterra.aibyteconsult.com,http://localhost:8080,http://localhost:4173' } } } });

const validate = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Validate Heritage', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: __VALIDATE__ } } });

const pg = { postgres: { id: 'MM4lAhvovYd5Gu5D', name: 'NICS Trading' } };
const run = node({ type: 'n8n-nodes-base.postgres', version: 2.6, config: { name: 'Run Heritage', credentials: pg, parameters: {
  operation: 'executeQuery', query: 'SELECT aquaterra_heritage($1::jsonb) AS r;', options: { queryReplacement: expr('{{ [$json.req] }}') } } } });

const needsChain = ifElse({ version: 2.2, config: { name: 'Needs Chain', parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr('{{ $json.r.check ? true : false }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });

const buildCall = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Build Call', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: __CHAIN__ } } });

const ownerOf = node({ type: 'n8n-nodes-base.httpRequest', version: 4.2, config: { name: 'Owner Of', onError: 'continueRegularOutput', parameters: {
  method: 'POST', url: expr('{{ $json.check.rpc }}'), sendBody: true, contentType: 'json', specifyBody: 'json',
  jsonBody: expr('{{ JSON.stringify($json.body) }}'),
  options: { timeout: 15000, response: { response: { neverError: true, responseFormat: 'json' } } } } } });

const readOwner = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Read Owner', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: __OWNER__ } } });

const ownerResult = node({ type: 'n8n-nodes-base.postgres', version: 2.6, config: { name: 'Owner Result', credentials: pg, parameters: {
  operation: 'executeQuery', query: 'SELECT aquaterra_heritage_internal($1::jsonb) AS r;', options: { queryReplacement: expr('{{ [$json.req] }}') } } } });

const respondChain = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.5, config: { name: 'Respond Chain', parameters: {
  respondWith: 'json', responseBody: expr('{{ $json.r }}'), options: { responseCode: expr('{{ $json.r.status || 200 }}') } } } });
const respond = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.5, config: { name: 'Respond Heritage', parameters: {
  respondWith: 'json', responseBody: expr('{{ $json.r }}'), options: { responseCode: expr('{{ $json.r.status || 200 }}') } } } });

export default workflow('aquaterra-heritage', '[71 PUBLIC] AquaTerra Heritage')
  .add(hook).to(validate).to(run)
  .to(needsChain.onTrue(buildCall.to(ownerOf.to(readOwner.to(ownerResult.to(respondChain))))).onFalse(respond));
