$file = 'platform/compiler/compose/generate-runtime-host.ts'
$lines = Get-Content $file -Encoding UTF8

function Find-FunctionRange($lines, $functionName) {
    $startLine = -1
    $braceDepth = 0
    $foundFirstBrace = $false
    
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($startLine -eq -1 -and $lines[$i] -match "^function $functionName") {
            $startLine = $i
            continue
        }
        if ($startLine -ge 0) {
            for ($c = 0; $c -lt $lines[$i].Length; $c++) {
                $ch = $lines[$i][$c]
                if ($ch -eq '{') {
                    $braceDepth++
                    $foundFirstBrace = $true
                } elseif ($ch -eq '}') {
                    $braceDepth--
                }
            }
            if ($foundFirstBrace -and $braceDepth -le 0) {
                return @($startLine, $i)
            }
        }
    }
    return @(-1, -1)
}

function Replace-Function($lines, $functionName, $newBody) {
    $range = Find-FunctionRange $lines $functionName
    $startLine = $range[0]
    $endLine = $range[1]
    
    if ($startLine -eq -1) {
        Write-Host "ERROR: Function $functionName not found"
        return $lines
    }
    
    Write-Host "Found $functionName : lines $($startLine+1) to $($endLine+1) ($($endLine - $startLine + 1) lines)"
    
    $newLines = @()
    $newLines += $lines[0..($startLine-1)]
    $newLines += $newBody
    $newLines += $lines[($endLine+1)..($lines.Count-1)]
    
    return $newLines
}

$newCustomersRoute = @(
    'function renderCustomersRoute(options: {'
    '  auditEnabled: boolean;'
    '  notifyEmailEnabled: boolean;'
    '  tableFilterEnabled: boolean;'
    '}): string {'
    '  return renderEntityApiRoute({'
    "    entityName: 'customer',"
    "    entityType: 'Customer',"
    "    entityPath: 'entity/customer-service.ts',"
    "    listFunction: 'listCustomers',"
    "    createFunction: 'createCustomer',"
    "    inputType: 'CustomerInput',"
    '    auditEnabled: options.auditEnabled,'
    '    notifyEmailEnabled: options.notifyEmailEnabled,'
    "    notifyFunction: 'recordCustomerCreatedEmail',"
    '    tableFilterEnabled: options.tableFilterEnabled,'
    "    filterFunction: 'filterCustomers'"
    '  });'
    '}'
)

$newTicketsRoute = @(
    'function renderTicketsRoute(options: { auditEnabled: boolean; notifyEmailEnabled: boolean }): string {'
    '  return renderEntityApiRoute({'
    "    entityName: 'ticket',"
    "    entityType: 'Ticket',"
    "    entityPath: 'ticket/ticket-service.ts',"
    "    listFunction: 'listTicketsWithFilters',"
    "    createFunction: 'createTicket',"
    "    inputType: 'TicketInput',"
    '    auditEnabled: options.auditEnabled,'
    '    notifyEmailEnabled: options.notifyEmailEnabled,'
    "    notifyFunction: 'recordTicketCreatedEmail',"
    '    tableFilterEnabled: false,'
    @("    extraImports: [""import type { TicketStatus } from '../../../src/runtime/database.ts';""],")
    @("    customGetBlock: ""  const tickets = listTicketsWithFilters(getDatabase(), session, readTicketFilters(request));"",")
    '    extraTopLevelCode: renderReadTicketFilters()'
    '  });'
    '}'
)

$lines = Replace-Function $lines 'renderCustomersRoute' $newCustomersRoute
$lines = Replace-Function $lines 'renderTicketsRoute' $newTicketsRoute

$insertBefore = 'function renderLoginForm(): string {'
$insertIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -eq $insertBefore) {
        $insertIdx = $i
        break
    }
}

if ($insertIdx -ge 0) {
    $newFunctions = @(
        'type EntityApiRouteOptions = {'
        '  entityName: string;'
        '  entityType: string;'
        '  entityPath: string;'
        '  listFunction: string;'
        '  createFunction: string;'
        '  inputType: string;'
        '  auditEnabled: boolean;'
        '  notifyEmailEnabled: boolean;'
        '  notifyFunction?: string;'
        '  tableFilterEnabled: boolean;'
        '  filterFunction?: string;'
        '  extraImports?: string[];'
        '  customGetBlock?: string;'
        '  extraTopLevelCode?: string;'
        '};'
        ''
        'function renderEntityApiRoute(options: EntityApiRouteOptions): string {'
        '  const imports = renderImportBlock(['
        @("    ""import { NextResponse } from 'next/server';"",")
        @("    ""import type { ${options.inputType} } from '../../../src/runtime/database.ts';"",")
        @("    ""import { ${options.createFunction}, ${options.listFunction} } from '../../../src/installed/${options.entityPath}';"",")
        @("    renderOptional(options.auditEnabled, ""import { appendAuditEntry, createAuditEntry } from '../../../src/installed/audit/logger.ts';""),")
        @("    renderOptional(options.notifyEmailEnabled && options.notifyFunction, ""import { ${options.notifyFunction} } from '../../../src/installed/notify/email-outbox.ts';""),")
        @("    renderOptional(options.tableFilterEnabled && options.filterFunction, ""import { ${options.filterFunction} } from '../../../src/installed/table/customer-filter.ts';""),")
        @("    ""import { getCurrentSession } from '../../../lib/session.ts';"",")
        @("    ""import { getDatabase } from '../../../lib/store.ts';"",")
        '    ...(options.extraImports ?? [])'
        '  ]);'
        '  const getBlock = options.customGetBlock ?? (options.tableFilterEnabled'
        '    ? `  const database = getDatabase();'
        '  const url = new URL(request.url);'
        '  const ${options.entityName}s = ${options.filterFunction}(${options.listFunction}(database, session), {'
        '    search: url.searchParams.get(''search''),'
        '    company: url.searchParams.get(''company'')'
        '  });'
        '`'
        '    : `  const database = getDatabase();'
        '  const ${options.entityName}s = ${options.listFunction}(database, session);'
        '`);'
        '  const mutationLines = renderOptionalSnippets(['
        @("    [options.auditEnabled, ""    database.auditEntries = appendAuditEntry(database.auditEntries, createAuditEntry(session, '${options.entityName}.created', '${options.entityName}', String(${options.entityName}.id)));""],")
        @("    [options.notifyEmailEnabled && options.notifyFunction, ""    ${options.notifyFunction}(database, session, ${options.entityName});""]")
        '  ]);'
        ''
        '  return `${imports}'
        '${options.extraTopLevelCode ?? ""}'
        'export async function GET(request: Request) {'
        '${renderSessionGuard()}'
        ''
        '${getBlock}  return NextResponse.json({ ${options.entityName}s });'
        '}'
        ''
        'export async function POST(request: Request) {'
        '${renderSessionGuard()}'
        ''
        '  try {'
        '    const database = getDatabase();'
        '    const payload = await request.json() as ${options.inputType};'
        '    const ${options.entityName} = ${options.createFunction}(database, session, payload);'
        '${mutationLines}    return NextResponse.json({ ${options.entityName} }, { status: 201 });'
        '  } catch (error) {'
        @("    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid payload' }, { status: 400 });")
        '  }'
        '}`;'
        '}'
        ''
        'function renderAuditSection(entityFilter?: string): string {'
        '  const filterSetup = entityFilter'
        @("    ? ""  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId && entry.entity === '${entityFilter}';""")
        @("    : ""  const auditEntries = database.auditEntries.filter((entry) => entry.tenantId === session.tenantId);""")
        '  const view = `'
        '      <section className="card stack">'
        '        <h2>Audit Trail</h2>'
        '        <ul className="clean" aria-label="Audit entries">'
        '          {auditEntries.map((entry) => ('
        '            <li key={`${entry.action}:${entry.entity}:${entry.entityId}`}>'
        '              <div><strong>{entry.action}</strong> {entry.entity} {entry.entityId}</div>'
        '              <div>{entry.actorId} in {entry.tenantId}</div>'
        '            </li>'
        '          ))}'
        '          {auditEntries.length === 0 ? <li>No audit entries yet.</li> : null}'
        '        </ul>'
        '      </section>'
        '`;'
        '  return `${filterSetup}${view}`;'
        '}'
        ''
        'function renderNotificationSection(entityFilter?: string): string {'
        '  const filterSetup = entityFilter'
        @("    ? ""  const ${entityFilter}Notifications = listEmailNotifications(database, session).filter((notification) => notification.entity === '${entityFilter}';""")
        @("    : ""  const notifications = listEmailNotifications(database, session);""")
        '  const listName = entityFilter ? `${entityFilter}Notifications` : ''notifications'';'
        '  const label = entityFilter ? `${entityFilter.charAt(0).toUpperCase() + entityFilter.slice(1)} Notifications` : ''Notifications'';'
        '  const view = `'
        '      <section className="card stack">'
        '        <h2>${label}</h2>'
        '        <ul className="clean" aria-label="Notifications">'
        '          {${listName}.map((notification) => ('
        '            <li key={notification.id}>'
        '              <div><strong>{notification.subject}</strong></div>'
        '              <div>{notification.recipient}</div>'
        '            </li>'
        '          ))}'
        '          {${listName}.length === 0 ? <li>No notifications yet.</li> : null}'
        '        </ul>'
        '      </section>'
        '`;'
        '  return `${filterSetup}${view}`;'
        '}'
        ''
    )
    
    $newLines = @()
    $newLines += $lines[0..($insertIdx-1)]
    $newLines += $newFunctions
    $newLines += $lines[$insertIdx..($lines.Count-1)]
    $lines = $newLines
    Write-Host "Inserted new functions before renderLoginForm at line $($insertIdx+1)"
}

Set-Content $file -Value $lines -Encoding UTF8
Write-Host "Done."
