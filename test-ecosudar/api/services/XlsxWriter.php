<?php
declare(strict_types=1);
/**
 * Minimal .xlsx writer. Builds the OOXML package in memory and zips it by hand,
 * so it needs neither PhpSpreadsheet nor the ext-zip / ext-xml extensions
 * (this box only has zlib + openssl).
 */

class XlsxWriter
{
    /** @var array<string,array> sheetName => rows */
    private array $sheets = [];

    public function addSheet(string $name, array $rows): void
    {
        $this->sheets[$name] = $rows;
    }

    /** Returns the raw .xlsx bytes. */
    public function build(): string
    {
        if (!$this->sheets) {
            $this->addSheet('Sheet1', []);
        }

        $parts = [];
        $sheetNames = array_keys($this->sheets);

        $ctOverrides = '';
        $wbSheets = '';
        $wbRels = '';
        $i = 0;
        foreach ($sheetNames as $name) {
            $i++;
            $parts["xl/worksheets/sheet{$i}.xml"] = $this->sheetXml($this->sheets[$name]);
            $ctOverrides .= '<Override PartName="/xl/worksheets/sheet' . $i . '.xml"'
                . ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
            $wbSheets .= '<sheet name="' . $this->esc($name) . '" sheetId="' . $i . '" r:id="rId' . $i . '"/>';
            $wbRels .= '<Relationship Id="rId' . $i . '"'
                . ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
                . ' Target="worksheets/sheet' . $i . '.xml"/>';
        }
        $styleRid = 'rId' . ($i + 1);
        $wbRels .= '<Relationship Id="' . $styleRid . '"'
            . ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
            . ' Target="styles.xml"/>';

        $parts['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml"'
            . ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . $ctOverrides
            . '<Override PartName="/xl/styles.xml"'
            . ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . '</Types>';

        $parts['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1"'
            . ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
            . ' Target="xl/workbook.xml"/>'
            . '</Relationships>';

        $parts['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            . ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets>' . $wbSheets . '</sheets></workbook>';

        $parts['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . $wbRels . '</Relationships>';

        $parts['xl/styles.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<fonts count="2">'
            . '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>'
            . '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>'
            . '</fonts>'
            . '<fills count="2"><fill><patternFill patternType="none"/></fill>'
            . '<fill><patternFill patternType="gray125"/></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="2">'
            . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            . '</cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';

        return $this->zip($parts);
    }

    private function sheetXml(array $rows): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<sheetData>';
        $r = 0;
        foreach ($rows as $row) {
            $r++;
            $xml .= '<row r="' . $r . '">';
            $c = 0;
            foreach ($row as $value) {
                $c++;
                $ref = $this->colName($c) . $r;
                $style = ($r === 1) ? ' s="1"' : '';
                if (is_int($value) || is_float($value)) {
                    $xml .= '<c r="' . $ref . '"' . $style . '><v>' . $value . '</v></c>';
                } else {
                    $xml .= '<c r="' . $ref . '"' . $style . ' t="inlineStr"><is><t>'
                        . $this->esc((string) $value) . '</t></is></c>';
                }
            }
            $xml .= '</row>';
        }
        return $xml . '</sheetData></worksheet>';
    }

    private function colName(int $n): string
    {
        $s = '';
        while ($n > 0) {
            $m = ($n - 1) % 26;
            $s = chr(65 + $m) . $s;
            $n = intdiv($n - 1, 26);
        }
        return $s;
    }

    private function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    /** Hand-rolled ZIP (deflate via zlib), because ext-zip is not installed. */
    private function zip(array $files): string
    {
        $now = getdate();
        $dosTime = ($now['hours'] << 11) | ($now['minutes'] << 5) | ($now['seconds'] >> 1);
        $dosDate = (($now['year'] - 1980) << 9) | ($now['mon'] << 5) | $now['mday'];

        $local = '';
        $central = '';
        $offset = 0;
        $count = 0;

        foreach ($files as $name => $data) {
            $crc = crc32($data);
            $rawLen = strlen($data);
            $deflated = gzdeflate($data, 9);
            if ($deflated === false || strlen($deflated) >= $rawLen) {
                $payload = $data;
                $method = 0;
            } else {
                $payload = $deflated;
                $method = 8;
            }
            $compLen = strlen($payload);

            $lfh = "PK\x03\x04" . pack('vvv', 20, 0, $method) . pack('vv', $dosTime, $dosDate)
                . pack('VVV', $crc, $compLen, $rawLen) . pack('vv', strlen($name), 0)
                . $name . $payload;
            $local .= $lfh;

            $central .= "PK\x01\x02" . pack('vvvv', 0x0314, 20, 0, $method)
                . pack('vv', $dosTime, $dosDate)
                . pack('VVV', $crc, $compLen, $rawLen)
                . pack('vvvvv', strlen($name), 0, 0, 0, 0)
                . pack('VV', 0x20, $offset) . $name;

            $offset += strlen($lfh);
            $count++;
        }

        $eocd = "PK\x05\x06" . pack('vvvv', 0, 0, $count, $count)
            . pack('VV', strlen($central), $offset) . pack('v', 0);

        return $local . $central . $eocd;
    }
}
