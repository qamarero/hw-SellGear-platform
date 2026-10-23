/**
 * Sobres y parsers SOAP de recogidas TIPSA.
 * Fixtures oficiales: docs/integrations/tipsa/extracted/Ejemplos/GrabaRecogida y ConsRecogida.
 * ConsRecogida, ConsRecIncidencias y BorraRecogida no traen ejemplo: se montan
 * con el formato que documenta el PDF v74.0 (paginas 17, 85 y 93).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GRABA_RECOGIDA_METHOD,
  buildBorraRecogidaEnvelope,
  buildConsRecEstadosEnvelope,
  buildGrabaRecogidaEnvelope,
  parseBorraRecogidaResponse,
  parseConsRecEstadosResponse,
  parseConsRecIncidenciasResponse,
  parseConsRecogidaResponse,
  parseGrabaRecogidaResponse,
} from '@/lib/tipsa/envelopes'
import { tipsaPickupIncidenceLabel } from '@/lib/tipsa/services'

const FIXTURES_BASE = resolve(__dirname, '..', '..', '..', 'docs', 'integrations', 'tipsa', 'extracted', 'Ejemplos')

function fixture(relativePath: string): string {
  return readFileSync(resolve(FIXTURES_BASE, relativePath), 'utf-8')
}

function wrap(method: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://tempuri.org/">
  <SOAP-ENV:Body>
    <v1:WebServService___${method}Response>${inner}</v1:WebServService___${method}Response>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`
}

const INPUT = {
  date: '2026-10-26',
  timeFrom: '09:00',
  timeTo: '14:00',
  packages: 2,
  weightKg: 4.5,
  serviceCode: '48',
  origin: {
    name: 'Bar La Esquina',
    address: 'C/ Ejemplo 12',
    city: 'Madrid',
    cp: '28004',
    phone: '600000000',
    contactPerson: 'Laura',
  },
  destination: {
    name: 'QR PAYMENTS Qamarero',
    address: 'P.º Alcalde Marqués del Contadero, s/n',
    city: 'Sevilla',
    cp: '41001',
    phone: '602687553',
  },
  reference: 'RC-202610-0001 RMA-2026-00123',
  observations: 'Preguntar por el encargado & no tocar',
  content: '10POS 10D-21 (SN 123)',
}

describe('buildGrabaRecogidaEnvelope', () => {
  const xml = buildGrabaRecogidaEnvelope({
    creds: { agencyCode: '041033', clientCode: '010' },
    sessionId: '{SESSION}',
    input: INPUT,
  })

  it('usa el metodo configurado y la sesion en la cabecera', () => {
    expect(xml).toContain(`<tem:WebServService___${GRABA_RECOGIDA_METHOD}>`)
    expect(xml).toContain('<tem:ID>{SESSION}</tem:ID>')
  })

  it('la paga nuestra agencia y deja que TIPSA canalice origen y destino', () => {
    expect(xml).toContain('<tem:strCodAgeCargo>041033</tem:strCodAgeCargo>')
    expect(xml).toContain('<tem:strCodAgeSol>041033</tem:strCodAgeSol>')
    expect(xml).toContain('<tem:strCodCli>010</tem:strCodCli>')
    expect(xml).not.toContain('strCodAgeOri')
    expect(xml).not.toContain('strCodAgeDes')
  })

  it('fecha y franja en formato TIPSA (YYYY/MM/DD HH:MM:SS)', () => {
    expect(xml).toContain('<tem:dtFecRec>2026/10/26</tem:dtFecRec>')
    expect(xml).toContain('<tem:dtHoraRecIni>2026/10/26 09:00:00</tem:dtHoraRecIni>')
    expect(xml).toContain('<tem:dtHoraRecFin>2026/10/26 14:00:00</tem:dtHoraRecFin>')
  })

  it('origen = cliente, destino = nosotros, y escapa el texto libre', () => {
    expect(xml).toContain('<tem:strNomOri>Bar La Esquina</tem:strNomOri>')
    expect(xml).toContain('<tem:strCPOri>28004</tem:strCPOri>')
    expect(xml).toContain('<tem:strPersContacto>Laura</tem:strPersContacto>')
    expect(xml).toContain('<tem:strCPDes>41001</tem:strCPDes>')
    expect(xml).toContain('<tem:strObs>Preguntar por el encargado &amp; no tocar</tem:strObs>')
    expect(xml).toContain('<tem:intBul>2</tem:intBul>')
    expect(xml).toContain('<tem:dPeso>4.5</tem:dPeso>')
    expect(xml).toContain('<tem:strRef>RC-202610-0001 RMA-2026-00123</tem:strRef>')
  })
})

describe('parseGrabaRecogidaResponse', () => {
  it('lee la respuesta oficial de GrabaRecogida10', () => {
    const r = parseGrabaRecogidaResponse(fixture('GrabaRecogida/GrabaRecogida10_response.txt'))
    expect(r.code).toBe('0028850418')
    expect(r.type).toBe('N')
    expect(r.originAgency).toBe('007000')
    expect(r.destinationAgency).toBe('028002')
    expect(r.guid).toBe('{360C6ABB-12C1-4544-AA06-FA951BE8C0F6}')
    expect(r.reservedAlbaran).toBeNull()
  })

  it('acepta cualquier version del metodo (GrabaRecogida6)', () => {
    const r = parseGrabaRecogidaResponse(fixture('GrabaRecogida/GrabaRecogida6_response.txt'))
    expect(r.code).toBe('0019459987')
    expect(r.originAgency).toBe('016000')
  })

  it('falla si TIPSA no devuelve codigo', () => {
    expect(() => parseGrabaRecogidaResponse(wrap('GrabaRecogida12', '<v1:strCodOut/>'))).toThrow(/strCodOut/)
  })
})

describe('ConsRecEstados', () => {
  it('pide por codigo de recogida', () => {
    expect(buildConsRecEstadosEnvelope('{S}', '0020974312')).toContain(
      '<tem:strCodRec>0020974312</tem:strCodRec>',
    )
  })

  it('lee el historial oficial con el catalogo de envios', () => {
    const events = parseConsRecEstadosResponse(fixture('ConsRecogida/ConsRecEstados_response.txt'))
    expect(events.map((e) => e.code)).toEqual(['1', '14', '4', '1'])
    expect(events[2].label).toBe('Incidencia')
    // 10/06/2020 16:33:09 es MM/DD en hora de Madrid (CEST, +2)
    expect(events[0].date).toBe('2020-10-06T14:33:09.000Z')
  })
})

describe('parseConsRecogidaResponse', () => {
  const cdata = (codEnv: string) =>
    `<v1:strRecogida><![CDATA[<CONSULTA><RECOGIDAS V_COD="0028850418" V_COD_ENV="${codEnv}" V_TIPO_REC="N" V_CP_ORI="28004"/></CONSULTA>]]></v1:strRecogida>`

  it('sin recoger: albaran null', () => {
    const info = parseConsRecogidaResponse(wrap('ConsRecogida', cdata('')))
    expect(info.code).toBe('0028850418')
    expect(info.albaran).toBeNull()
  })

  it('recogida: devuelve el albaran del envio generado', () => {
    const info = parseConsRecogidaResponse(wrap('ConsRecogida', cdata('0000012890')))
    expect(info.albaran).toBe('0000012890')
  })
})

describe('parseConsRecIncidenciasResponse', () => {
  it('lee las INC e ignora las actuaciones', () => {
    const xml = wrap(
      'ConsRecIncidencias',
      `<v1:strRecIncidencias><![CDATA[<CONSULTA><REC_INCIDENCIAS><INC I_ID="1" V_COD_TIPO_INC="AS" T_OBS="Nadie en el local" B_RESUELTA="False" D_FEC_HORA_ALTA="10/26/2026 11:47:00"/><ACT I_ID="1" V_COD_TIPO_ACTU="X" D_FEC_HORA_ALTA="10/26/2026 12:00:00"/></REC_INCIDENCIAS></CONSULTA>]]></v1:strRecIncidencias>`,
    )
    const inc = parseConsRecIncidenciasResponse(xml)
    expect(inc).toHaveLength(1)
    expect(inc[0]).toMatchObject({ code: 'AS', label: 'Ausente', observations: 'Nadie en el local', resolved: false })
    // 26/10/2026 ya es horario de invierno (CET, +1)
    expect(inc[0].date).toBe('2026-10-26T10:47:00.000Z')
  })

  it('sin incidencias: lista vacia', () => {
    expect(parseConsRecIncidenciasResponse(wrap('ConsRecIncidencias', '<v1:strRecIncidencias/>'))).toEqual([])
  })

  it('un tipo sin catalogar no se inventa', () => {
    expect(tipsaPickupIncidenceLabel('ZZ')).toBe('Incidencia ZZ')
  })
})

describe('BorraRecogida', () => {
  it('pide por codigo', () => {
    expect(buildBorraRecogidaEnvelope('{S}', '0028850418')).toContain('<tem:strCodRec>0028850418</tem:strCodRec>')
  })

  it('0 o vacio = borrada; otro codigo = error', () => {
    expect(parseBorraRecogidaResponse(wrap('BorraRecogida', '<v1:intCodErrorOut>0</v1:intCodErrorOut>')).errorCode).toBeNull()
    expect(parseBorraRecogidaResponse(wrap('BorraRecogida', '<v1:intCodErrorOut/>')).errorCode).toBeNull()
    expect(parseBorraRecogidaResponse(wrap('BorraRecogida', '<v1:intCodErrorOut>2</v1:intCodErrorOut>')).errorCode).toBe('2')
  })
})
