"""Génère tests/fixtures/ctrader-exemple.xlsx : relevé cTrader synthétique (structure supposée).

À remplacer par un vrai export dès qu'il est disponible.
"""
import os
import zipfile
from xml.sax.saxutils import escape

ICI = os.path.dirname(os.path.abspath(__file__))

LIGNES = [
    ["Statement", "", "", ""],
    ["Account: 1234567 (Demo)", "", "", ""],
    [],
    ["ID", "Order ID", "Symbol", "Opening Direction", "Closing Direction", "Opening Time (UTC+1)",
     "Closing Time (UTC+1)", "Entry Price", "Closing Price", "Closing Quantity", "Closing USD Volume",
     "Swap", "Commission", "Gross USD", "Net USD", "Balance USD", "Pips", "Requested Quantity",
     "Channel", "Label", "Comment"],
    # Trade 1 : long, fermé en deux fois (fermeture partielle)
    [1001, 5001, "US100", "Buy", "Sell", "14/10/2026 15:41:12.345", "14/10/2026 15:58:03.120", 21000.5,
     21030.5, 1, 21030.5, 0, -1.5, 30, 28.5, 100028.5, 30, 2, "Desktop", "", ""],
    [1002, 5002, "US100", "Buy", "Sell", "14/10/2026 15:41:12.345", "14/10/2026 16:10:44.001", 21000.5,
     21060.5, 1, 21060.5, 0, -1.5, 60, 58.5, 100087, 60, 2, "Desktop", "", ""],
    # Trade 2 : short perdant, montant avec séparateur de milliers
    [1003, 5003, "US100", "Sell", "Buy", "15/10/2026 16:05:00.000", "15/10/2026 16:20:30.000", "21,100.00",
     "21,120.00", 2, 42240, 0, -3, -40, -43, 100044, -20, 2, "Desktop", "", ""],
    # Ligne de total (à ignorer)
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "Total", "", "", "", "", "", ""],
]


def col(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def main():
    chaines = []
    lignes_xml = []
    for n, ligne in enumerate(LIGNES, start=1):
        cellules = []
        for i, v in enumerate(ligne):
            ref = f"{col(i)}{n}"
            if isinstance(v, (int, float)):
                cellules.append(f'<c r="{ref}"><v>{v}</v></c>')
            elif v != "":
                if v not in chaines:
                    chaines.append(v)
                cellules.append(f'<c r="{ref}" t="s"><v>{chaines.index(v)}</v></c>')
        lignes_xml.append(f'<row r="{n}">{"".join(cellules)}</row>')
    feuille = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
               f'<sheetData>{"".join(lignes_xml)}</sheetData></worksheet>')
    sst = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(chaines)}">'
           + "".join(f"<si><t>{escape(c)}</t></si>" for c in chaines) + "</sst>")
    classeur = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="History" sheetId="1" r:id="rId1"/></sheets></workbook>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>')
    with zipfile.ZipFile(os.path.join(ICI, "ctrader-exemple.xlsx"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("xl/workbook.xml", classeur)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", feuille)


if __name__ == "__main__":
    main()
