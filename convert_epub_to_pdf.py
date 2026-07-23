import os
import zipfile
import re
from xml.etree import ElementTree as ET
from bs4 import BeautifulSoup
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

def convert_epub_to_pdf(epub_path, pdf_path):
    print(f"Reading {epub_path}...")
    
    # 1. Register Cyrillic TrueType Fonts from Windows
    font_path = "C:\\Windows\\Fonts\\times.ttf"
    font_bold_path = "C:\\Windows\\Fonts\\timesbd.ttf"
    font_italic_path = "C:\\Windows\\Fonts\\timesi.ttf"
    
    if not os.path.exists(font_path):
        font_path = "C:\\Windows\\Fonts\\arial.ttf"
        font_bold_path = "C:\\Windows\\Fonts\\arialbd.ttf"
        font_italic_path = "C:\\Windows\\Fonts\\ariali.ttf"
        
    pdfmetrics.registerFont(TTFont("CustomFont", font_path))
    pdfmetrics.registerFont(TTFont("CustomFont-Bold", font_bold_path))
    pdfmetrics.registerFont(TTFont("CustomFont-Italic", font_italic_path))
    
    # 2. Extract EPUB structure
    with zipfile.ZipFile(epub_path, 'r') as z:
        # Find container.xml to locate OPF file
        container_xml = z.read("META-INF/container.xml")
        root = ET.fromstring(container_xml)
        opf_rel_path = root.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile").attrib["full-path"]
        
        opf_dir = os.path.dirname(opf_rel_path)
        opf_content = z.read(opf_rel_path)
        opf_tree = ET.fromstring(opf_content)
        
        # Manifest items
        manifest = {}
        for item in opf_tree.findall(".//{http://www.idpf.org/2007/opf}item"):
            manifest[item.attrib["id"]] = item.attrib["href"]
            
        # Spine order
        spine = []
        for itemref in opf_tree.findall(".//{http://www.idpf.org/2007/opf}spine/{http://www.idpf.org/2007/opf}itemref"):
            idref = itemref.attrib["idref"]
            if idref in manifest:
                href = manifest[idref]
                full_path = os.path.normpath(os.path.join(opf_dir, href)).replace("\\", "/")
                spine.append(full_path)
                
        print(f"Found {len(spine)} chapter files in spine.")
        
        # Build ReportLab Story
        styles = getSampleStyleSheet()
        
        title_style = ParagraphStyle(
            'BookTitle',
            parent=styles['Normal'],
            fontName='CustomFont-Bold',
            fontSize=24,
            leading=28,
            alignment=TA_CENTER,
            spaceAfter=20
        )
        
        h1_style = ParagraphStyle(
            'BookH1',
            parent=styles['Normal'],
            fontName='CustomFont-Bold',
            fontSize=16,
            leading=20,
            alignment=TA_CENTER,
            spaceBefore=15,
            spaceAfter=10,
            keepWithNext=True
        )

        h2_style = ParagraphStyle(
            'BookH2',
            parent=styles['Normal'],
            fontName='CustomFont-Bold',
            fontSize=13,
            leading=16,
            alignment=TA_CENTER,
            spaceBefore=12,
            spaceAfter=8,
            keepWithNext=True
        )

        body_style = ParagraphStyle(
            'BookBody',
            parent=styles['Normal'],
            fontName='CustomFont',
            fontSize=10.5,
            leading=14,
            alignment=TA_JUSTIFY,
            firstLineIndent=18,
            spaceAfter=4
        )
        
        story = []
        chapter_count = 0
        
        for ch_path in spine:
            try:
                ch_html = z.read(ch_path).decode('utf-8', errors='ignore')
            except Exception as e:
                continue
                
            soup = BeautifulSoup(ch_html, 'html.parser')
            
            # Extract elements
            elements = soup.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'div'])
            if not elements:
                continue
                
            has_content = False
            for elem in elements:
                text = elem.get_text().strip()
                if not text:
                    continue
                    
                # Clean text for ReportLab (escape special XML chars)
                clean_text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                
                if elem.name in ['h1', 'h2']:
                    story.append(Spacer(1, 10))
                    story.append(Paragraph(clean_text, h1_style))
                    story.append(Spacer(1, 8))
                    has_content = True
                elif elem.name in ['h3', 'h4']:
                    story.append(Paragraph(clean_text, h2_style))
                    has_content = True
                elif elem.name == 'p':
                    story.append(Paragraph(clean_text, body_style))
                    has_content = True
                elif elem.name == 'div' and not elem.find_all(['p', 'h1', 'h2', 'h3', 'h4']):
                    story.append(Paragraph(clean_text, body_style))
                    has_content = True
                    
            if has_content:
                chapter_count += 1
                
        print(f"Processed {chapter_count} chapters into {len(story)} story elements.")
        
        # Build PDF
        doc = SimpleDocTemplate(
            pdf_path,
            pagesize=letter,
            rightMargin=54, leftMargin=54, topMargin=54, bottomMargin=54
        )
        print("Generating PDF file...")
        doc.build(story)
        print(f"PDF successfully generated at: {pdf_path}")

if __name__ == "__main__":
    epub_file = "c:\\Users\\Admin\\Desktop\\book-mcp\\Братья_Карамазовы.epub"
    pdf_file = "c:\\Users\\Admin\\Desktop\\book-mcp\\Братья_Карамазовы.pdf"
    convert_epub_to_pdf(epub_file, pdf_file)
