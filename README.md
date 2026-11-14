## StudyFlowMD
O platformă pentru studenți care permite gestionarea termenelor limită și a examenelor, precum și conversia notițelor scrise de mână, fotografiate sau în format digital, în text Markdown pentru un consum eficient de tokenuri și utilizarea lor inclusiv cu modele AI locale fără suport pentru imagini.

## Tehnologii Utilizate
- **Backend**: Django 6 (Python 3.12+)
- **API**: Django REST Framework
- **OCR**: Tesseract (pytesseract) și Pillow
- **Frontend**: JavaScript (ES6+), Bootstrap 5, CSS3 Custom Styles
- **Bază de date**: PostgreSQL
- **Task Queue**: Celery & Redis (pentru procesări asincrone)
- **Containerizare**: Docker & Docker Compose


## Funcționalități
- **Dashboard Interactiv**: Vizualizarea și gestionarea examenelor, parțialelor, termenelor de predare și progresului task-urilor într-un singur loc.
- **Sistem de Task-uri**: Crearea, editarea și ștergerea temelor și a task-urilor de studiu.
- **Notificări în Fundal**: Remindere automate pentru termenele limită, examenele și parțialele care se apropie, gestionate prin Celery & Redis.
- **Gestionarea Utilizatorilor**: Înregistrare, autentificare și spații personale pentru gestionarea materiilor, task-urilor și notițelor.
- **Conversia Notițelor**: Încărcarea fotografiilor cu notițe scrise de mână, extragerea textului prin OCR și verificarea, editarea sau descărcarea acestuia în text în format Markdown.
- **Partajarea Notițelor**: Generarea unui link prin care studenții pot oferi colegilor acces la notițele lor, cu posibilitatea de a revoca accesul ulterior.

## Optimizarea consumului de tokenuri AI
Telefoanele moderne fac fotografii foarte detaliate, la rezoluții de 4K sau mai mari. Dar o fotografie cu o rezolutie mai mare nu înseamnă mai multă informație utilă pentru AI.

Modelele AI procesează imaginile împărțindu-le în secțiuni mici, numite **tiles/patches**. Consumul de tokenuri depinde de rezoluție și de setările de procesare, nu doar de numărul de cuvinte de pe pagină. O fotografie de rezoluție înaltă care conține doar două propoziții consuma mai multe tokenuri decât trimiterea acelorași propoziții ca text simplu.

### Exemplu

Imaginează-ți că te întorci din vacanță și împrumuți caietul unui coleg pentru a recupera materia. Fotografiezi 20 de pagini cu telefonul și vrei ca AI-ul să îți explice ce ai pierdut.

Trimiterea directă a fotografiilor presupune procesarea imaginilor paginilor, inclusiv a spațiilor goale, a marginilor și a liniilor caietului.

**StudyFlowMD** este conceput să extragă textul folosind **OCR (Optical Character Recognition)** și să îl salveze în format Markdown: text simplu, cu formatare pentru titluri și liste. Poți apoi reutiliza notițele pentru rezumate, explicații și întrebări de recapitulare.


## Ce probleme rezolvă?
1. **Mai mult spațiu în fereastra de context:** Modelele AI au o limită de informație pe care o pot procesa, numită "fereastră de context", sau mai comun in engleză: **context window**. Fotografiile ocupa mai mult din acest spațiu decât textul extras din ele. Conversia în text utilizează mai eficient fereastra de context.

2. **Consum redus de tokenuri:** Trimiterea textului extras consuma mai puține tokenuri decât procesarea fotografiilor originale. Acest lucru reduce costurile atunci când se folosește un API plătit.


## Exemplu ilustrativ: fotografie a unui caiet, împărțirea fotografiei în **tiles/patches**:
- 🟧 **Zone cu conținut irelevant:** fundalul și obiectele din jurul caietului.
- 🟦 **Zone cu puțin text și mult spațiu gol:** ocupă o parte din imagine, deși conțin puțină informație

Toate aceste zone sunt incluse în procesarea imaginii. Extragerea textului prin OCR permite trimiterea notițelor fără fundalul și spațiile goale din fotografie.

<img width="825" height="1098" alt="2222" src="https://github.com/user-attachments/assets/5fd8d21e-9573-410b-b2d0-c03b6848519b" />

## Avantaj pentru modelele AI locale
Multe modele populare care rulează local, precum **Qwen3**, **Llama 3.1** și **DeepSeek-R1**, acceptă doar text, fără posibilitatea de a interpreta direct imagini.

Prin extragerea notițelor cu **OCR** și salvarea lor în text, **StudyFlowMD** permite folosirea acestora și cu modele fără suport pentru imagini. Studentul poate importa textul într-un model local pentru explicații, rezumate și întrebări de recapitulare.

## Creeare SKILL.md
Transformă o materie într-un fișier SKILL.md pentru AI cu instrucțiuni personalizate, precum explicații pas cu pas sau afișarea formulelor, descarcand toate notițele ca referințe.

<img width="645" height="1101" alt="image" src="https://github.com/user-attachments/assets/9a26739f-7929-4662-b77c-076eb1e5b033" />

