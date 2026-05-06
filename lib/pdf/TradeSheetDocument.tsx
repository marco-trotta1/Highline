import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import type {
  CutoutDailyRow,
  FuturesSnapshotRow,
  SignalSnapshotRow,
  SubprimalPriceRow,
} from '@/lib/types';

type Grade = 'Choice' | 'Select' | 'Choice and Select';

const GRADES: Grade[] = ['Choice', 'Select', 'Choice and Select'];

const PRIMAL_ORDER = [
  'Rib',
  'Chuck',
  'Brisket',
  'Short Plate',
  'Round',
  'Loin',
  'Flank',
] as const;

type Primal = (typeof PRIMAL_ORDER)[number];

type DisplayRow = {
  item_description: string;
  primal: Primal | null;
  brand: string;
  grade: Grade;
  channel: 'AM' | 'PM';
  price_range_low: number | null;
  price_range_high: number | null;
  weighted_average: number | null;
  delta: number | null;
};

type TradeSheetDocumentProps = {
  rows: SubprimalPriceRow[];
  cutout: CutoutDailyRow | null;
  futures: FuturesSnapshotRow | null;
  signal: SignalSnapshotRow | null;
  generatedAt: Date;
  logoSrc: string;
};

function getPrimal(desc: string): Primal | null {
  if (desc.startsWith('Rib')) return 'Rib';
  if (desc.startsWith('Chuck')) return 'Chuck';
  if (desc.startsWith('Brisket')) return 'Brisket';
  if (desc.startsWith('Short Plate')) return 'Short Plate';
  if (desc.startsWith('Round')) return 'Round';
  if (desc.startsWith('Loin')) return 'Loin';
  if (desc.startsWith('Flank')) return 'Flank';
  return null;
}

function buildDisplayRows(rows: SubprimalPriceRow[]): DisplayRow[] {
  const result: DisplayRow[] = [];

  for (const grade of GRADES) {
    const gradeRows = rows.filter((row) => row.grade === grade);
    const hasBothSessions =
      gradeRows.some((row) => row.session === 'AM') &&
      gradeRows.some((row) => row.session === 'PM');
    const byItem = new Map<string, { am?: SubprimalPriceRow; pm?: SubprimalPriceRow }>();

    for (const row of gradeRows) {
      const entry = byItem.get(row.item_description) ?? {};
      if (row.session === 'AM') entry.am = row;
      if (row.session === 'PM') entry.pm = row;
      byItem.set(row.item_description, entry);
    }

    for (const [item_description, { am, pm }] of byItem) {
      const display = pm ?? am;
      if (!display) continue;
      result.push({
        item_description,
        primal: getPrimal(item_description),
        brand: 'AgriBeef',
        grade,
        channel: display.session,
        price_range_low: display.price_range_low,
        price_range_high: display.price_range_high,
        weighted_average: display.weighted_average,
        delta:
          hasBothSessions &&
          am?.weighted_average != null &&
          pm?.weighted_average != null
            ? pm.weighted_average - am.weighted_average
            : null,
      });
    }
  }

  return result.sort((a, b) => {
    const gradeDiff = GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade);
    if (gradeDiff !== 0) return gradeDiff;
    const channelDiff = a.channel.localeCompare(b.channel);
    if (channelDiff !== 0) return channelDiff;
    const aIdx =
      a.primal !== null
        ? (PRIMAL_ORDER as readonly string[]).indexOf(a.primal)
        : PRIMAL_ORDER.length;
    const bIdx =
      b.primal !== null
        ? (PRIMAL_ORDER as readonly string[]).indexOf(b.primal)
        : PRIMAL_ORDER.length;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.item_description.localeCompare(b.item_description);
  });
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function fmtMoney(value: number | null | undefined): string {
  return value == null ? '--' : value.toFixed(2);
}

function fmtSigned(value: number | null | undefined): string {
  if (value == null) return '--';
  if (value === 0) return '0.00';
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
}

function fmtPercent(value: number | null | undefined): string {
  if (value == null) return '--';
  return `${Math.round(value * 100)}%`;
}

function marketContext(
  signal: SignalSnapshotRow | null,
  cutout: CutoutDailyRow | null,
  futures: FuturesSnapshotRow | null
): string {
  if (signal?.notes) return signal.notes;
  const parts: string[] = [];
  if (cutout?.choice_total != null) {
    parts.push(`Choice cutout ${fmtMoney(cutout.choice_total)}`);
  }
  if (cutout?.select_total != null) {
    parts.push(`Select cutout ${fmtMoney(cutout.select_total)}`);
  }
  if (futures?.change_today != null) {
    parts.push(`Futures ${fmtSigned(futures.change_today)}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'Latest market data snapshot';
}

function groupRows(rows: DisplayRow[]): Array<{ key: string; rows: DisplayRow[] }> {
  const groups = new Map<string, DisplayRow[]>();
  for (const row of rows) {
    const key = `${row.brand} | ${row.grade} | ${row.channel}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }
  return Array.from(groups.entries()).map(([key, group]) => ({ key, rows: group }));
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
    paddingBottom: 38,
    fontFamily: 'Helvetica',
    color: '#111827',
    fontSize: 8,
    backgroundColor: '#ffffff',
  },
  header: {
    backgroundColor: '#1a1a2e',
    color: '#ffffff',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    width: 120,
    height: 30,
    objectFit: 'contain',
  },
  titleBlock: {
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 0,
  },
  dateText: {
    color: '#ffffff',
    fontSize: 9,
    marginTop: 3,
  },
  summary: {
    borderColor: '#e5e7eb',
    borderWidth: 1,
    marginTop: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  signalBox: {
    width: 132,
    borderRightColor: '#e5e7eb',
    borderRightWidth: 1,
    paddingRight: 10,
  },
  eyebrow: {
    color: '#6b7280',
    fontSize: 7,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  direction: {
    color: '#111827',
    fontSize: 17,
    fontWeight: 700,
  },
  confidence: {
    color: '#111827',
    fontSize: 9,
    marginTop: 3,
  },
  contextBox: {
    flex: 1,
    paddingHorizontal: 12,
  },
  contextText: {
    color: '#111827',
    fontSize: 10,
    lineHeight: 1.35,
  },
  futuresBox: {
    width: 210,
    borderLeftColor: '#e5e7eb',
    borderLeftWidth: 1,
    paddingLeft: 10,
  },
  futuresRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  futuresLabel: {
    color: '#6b7280',
    fontSize: 7,
    textTransform: 'uppercase',
  },
  futuresValue: {
    color: '#111827',
    fontSize: 10,
    fontWeight: 700,
  },
  table: {
    marginTop: 12,
    borderColor: '#d1d5db',
    borderWidth: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomColor: '#d1d5db',
    borderBottomWidth: 1,
  },
  headerCell: {
    paddingVertical: 6,
    paddingHorizontal: 5,
    color: '#111827',
    fontSize: 7,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  groupRow: {
    backgroundColor: '#16213e',
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  groupText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
  },
  altRow: {
    backgroundColor: '#f9fafb',
  },
  cell: {
    paddingVertical: 5,
    paddingHorizontal: 5,
    color: '#111827',
    fontSize: 7.5,
  },
  numericCell: {
    textAlign: 'right',
  },
  positive: {
    color: '#16a34a',
  },
  negative: {
    color: '#dc2626',
  },
  muted: {
    color: '#6b7280',
  },
  colSubPrimal: {
    width: '25%',
  },
  colBrand: {
    width: '10%',
  },
  colGrade: {
    width: '13%',
  },
  colChannel: {
    width: '8%',
  },
  colBid: {
    width: '10%',
  },
  colCutout: {
    width: '14%',
  },
  colDelta: {
    width: '10%',
  },
  footer: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 16,
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    paddingTop: 8,
    color: '#6b7280',
    fontSize: 8,
    textAlign: 'center',
  },
});

export function TradeSheetDocument({
  rows,
  cutout,
  futures,
  signal,
  generatedAt,
  logoSrc,
}: TradeSheetDocumentProps) {
  const displayRows = buildDisplayRows(rows);
  const groups = groupRows(displayRows);
  const generatedDate = fmtDate(generatedAt);
  const footerDate = fmtIsoDate(generatedAt);
  const footerTime = fmtTime(generatedAt);
  const direction = signal?.direction.toUpperCase() ?? 'NEUTRAL';

  return (
    <Document
      title={`Highline Trade Sheet ${footerDate}`}
      author="Highline"
      creator="Highline"
      producer="Highline"
    >
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logoSrc} style={styles.logo} />
          <View style={styles.titleBlock}>
            <Text style={styles.title}>DAILY TRADE SHEET</Text>
            <Text style={styles.dateText}>{generatedDate}</Text>
          </View>
          <Text style={styles.dateText}>{footerDate}</Text>
        </View>

        <View style={styles.summary}>
          <View style={styles.signalBox}>
            <Text style={styles.eyebrow}>Signal</Text>
            <Text style={styles.direction}>{direction}</Text>
            <Text style={styles.confidence}>
              Confidence {fmtPercent(signal?.confidence)}
            </Text>
          </View>
          <View style={styles.contextBox}>
            <Text style={styles.eyebrow}>Market Context</Text>
            <Text style={styles.contextText}>
              {marketContext(signal, cutout, futures)}
            </Text>
          </View>
          <View style={styles.futuresBox}>
            <Text style={styles.eyebrow}>Futures</Text>
            <View style={styles.futuresRow}>
              <Text style={styles.futuresLabel}>Contract</Text>
              <Text style={styles.futuresValue}>
                {futures?.front_month_contract ?? '--'}
              </Text>
            </View>
            <View style={styles.futuresRow}>
              <Text style={styles.futuresLabel}>Price</Text>
              <Text style={styles.futuresValue}>
                {fmtMoney(futures?.front_month_price)}
              </Text>
            </View>
            <View style={styles.futuresRow}>
              <Text style={styles.futuresLabel}>Daily Change</Text>
              <Text
                style={[
                  styles.futuresValue,
                  (futures?.change_today ?? 0) > 0
                    ? styles.positive
                    : (futures?.change_today ?? 0) < 0
                      ? styles.negative
                      : styles.muted,
                ]}
              >
                {fmtSigned(futures?.change_today)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.headerCell, styles.colSubPrimal]}>Sub-Primal</Text>
            <Text style={[styles.headerCell, styles.colBrand]}>Brand</Text>
            <Text style={[styles.headerCell, styles.colGrade]}>Grade</Text>
            <Text style={[styles.headerCell, styles.colChannel]}>Channel</Text>
            <Text style={[styles.headerCell, styles.colBid, styles.numericCell]}>
              Bid Low
            </Text>
            <Text style={[styles.headerCell, styles.colBid, styles.numericCell]}>
              Bid High
            </Text>
            <Text style={[styles.headerCell, styles.colCutout, styles.numericCell]}>
              Last Cutout
            </Text>
            <Text style={[styles.headerCell, styles.colDelta, styles.numericCell]}>
              Delta
            </Text>
          </View>

          {groups.map((group) => (
            <View key={group.key}>
              <View style={styles.groupRow}>
                <Text style={styles.groupText}>{group.key}</Text>
              </View>
              {group.rows.map((row, index) => (
                <View
                  key={`${group.key}-${row.item_description}`}
                  wrap={false}
                  style={[
                    styles.row,
                    ...(index % 2 === 1 ? [styles.altRow] : []),
                  ]}
                >
                  <Text style={[styles.cell, styles.colSubPrimal]}>
                    {row.item_description}
                  </Text>
                  <Text style={[styles.cell, styles.colBrand]}>{row.brand}</Text>
                  <Text style={[styles.cell, styles.colGrade]}>{row.grade}</Text>
                  <Text style={[styles.cell, styles.colChannel]}>{row.channel}</Text>
                  <Text style={[styles.cell, styles.colBid, styles.numericCell]}>
                    {fmtMoney(row.price_range_low)}
                  </Text>
                  <Text style={[styles.cell, styles.colBid, styles.numericCell]}>
                    {fmtMoney(row.price_range_high)}
                  </Text>
                  <Text style={[styles.cell, styles.colCutout, styles.numericCell]}>
                    {fmtMoney(row.weighted_average)}
                  </Text>
                  <Text
                    style={[
                      styles.cell,
                      styles.colDelta,
                      styles.numericCell,
                      row.delta == null || row.delta === 0
                        ? styles.muted
                        : row.delta > 0
                          ? styles.positive
                          : styles.negative,
                    ]}
                  >
                    {fmtSigned(row.delta)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <Text style={styles.footer} fixed>
          Powered by Highline | AgriBeef Commercial Pricing | {footerDate}{' '}
          {footerTime}
        </Text>
      </Page>
    </Document>
  );
}
