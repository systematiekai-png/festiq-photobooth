# Festiq photobooth platform

Een echt werkend platform: photobooth-app (iPad / laptop / 360°-booth), webdashboard en gastengalerij.
Foto's en video's worden op de server opgeslagen (SQLite + bestanden), niet in de browser.

## Starten

    npm install
    ADMIN_PASSWORD=mijnwachtwoord npm start

- Dashboard: http://localhost:3000/admin
- Booth: http://localhost:3000/booth/<slug>  (link staat in het dashboard bij het evenement)
- Galerij voor gasten: http://localhost:3000/gallery/<slug>
- Download-pagina per foto (via QR): /p/<id>

Zonder ADMIN_PASSWORD is het wachtwoord `photobooth`. Verander dat altijd.

## Wat kan het

- Twee boothtypes per evenement: de **iPad-booth** (maakt altijd een fotostrip van 2, 3 of 4 foto's) en de **360°-booth** (video-opname, instelbare lengte)
- **Ontwerpen (fotostrip-kaders)**: 7 ingebouwde ontwerpen in de Festiq-huisstijl en een eigen ontwerpeditor (zie hieronder). Per evenement kies je in het dashboard welk ontwerp gebruikt wordt (gasten kiezen dit niet zelf)
- Huisstijl per evenement: kleur, welkomsttekst, tekst onderaan de foto
- Na het maken van de foto of video wordt hij automatisch opgeslagen; er verschijnt meteen een QR-code waarmee gasten hem op hun eigen telefoon downloaden (geen extra tik op een "opslaan"-knop nodig)
- Dashboard: evenementen aanmaken/bewerken/verwijderen, statistieken, galerij, foto's verwijderen, ZIP- en CSV-export
- Publieke galerij met automatische verversing en diavoorstelling (`?slideshow`)
- Camera ondersteboven? Tik op de booth linksboven in de knoppenrij op **180°**: het beeld (voorbeeld, foto's en video's) wordt gedraaid. De keuze wordt op dat apparaat onthouden
- Kioskmodus voor de booth: `/booth/<slug>?kiosk` (verbergt de knoppen, scherm blijft aan)

## Telefoon als camera, bedienen vanaf je MacBook

Gebruik een telefoon (bijv. Samsung Galaxy Fold) als camera en bedien alles vanaf je Mac, met live beeld.

1. Start de photobooth op de Mac (Start-Photobooth.command) en open het HTTPS-adres (`…trycloudflare.com/admin`).
2. Klik bij het evenement op **🎛 Bediening**. Die pagina toont een QR-code.
3. Scan de QR-code met de telefoon en open de link in Chrome. Sta de camera toe. De telefoon gebruikt standaard de achtercamera (`&facing=back`); met **⟲ Camera** op de Mac wissel je.
4. Tik één keer op het scherm van de telefoon, zodat het geluid (piepjes, muziek bij 360°) aan mag.
5. Op de Mac zie je nu het live beeld. Druk op **Start** (of de spatiebalk). Het aftellen, de opname en de QR-code voor de gast zie je op de Mac én op de telefoon. **Esc** annuleert of gaat terug naar het startscherm.

Het live beeld gaat rechtstreeks van telefoon naar Mac (WebRTC) als ze op hetzelfde wifi-netwerk zitten. Lukt dat niet, dan schakelt de bediening vanzelf over op beeld via de server (iets schokkeriger, linksonder staat welke verbinding gebruikt wordt). Houd Chrome op de telefoon op de voorgrond: op de achtergrond stopt Android de camera. Zet de telefoon aan de oplader en schakel automatische schermvergrendeling bij voorkeur uit.

## Naam van de gast

Na de laatste foto ziet de gast zijn fotostrip met daarnaast **Hoe heet je?**. De gast typt zijn naam en tikt op **Opslaan** (of Enter), of kiest **Overslaan**. Daarna verschijnt de QR-code met "Bedankt, <naam>!". De fotostrip wordt intussen al opgeslagen, dus er gaat geen tijd verloren. Zonder invoer gaat de booth na 60 seconden vanzelf door.

De naam staat bij de foto in het dashboard, op de downloadpagina, in de CSV (kolom `naam`) en in de bestandsnamen van de ZIP en de download (bijv. `bruiloft-012-lisa-de-vries.jpg`). Op de bedieningspagina (Mac) kun je de naam ook zelf intypen. Uitzetten kan per evenement via "Bewerken".

## Werkt ook als het internet wegvalt

De booth (iPad en 360°) slaat elke fotostrip en video eerst op het apparaat zelf op en uploadt hem daarna op de achtergrond. Valt het internet weg, dan gaat de booth gewoon door:

- Gasten maken foto's en video's zoals altijd en krijgen meteen hun QR-code (die wordt op het apparaat zelf gemaakt).
- Linksonder staat dan **Geen internet · 3 opnames wachten op upload**. Zodra het internet terug is, worden ze vanzelf geüpload, in de goede volgorde en met de naam van de gast.
- Scant een gast de QR-code voordat zijn foto binnen is, dan ziet hij "Bijna klaar…" en verschijnt de foto vanzelf zodra hij geüpload is (zijn telefoon heeft meestal gewoon 4G/5G).
- Zelfs herladen of opnieuw openen van de booth zonder internet werkt, zolang de booth **één keer met internet** op dat apparaat is geopend. Ontwerp, stickers, videokader en muziek worden dan op het apparaat bewaard.

Let op:
- Open de booth op de dag zelf één keer met internet, en daarna altijd op dezelfde manier (bijv. steeds in Safari, niet afwisselend in Safari en via een beginschermicoon: die bewaren los van elkaar).
- Wis tijdens het evenement niet de websitegegevens/geschiedenis van de browser: daar staan de nog niet geüploade opnames.
- De bediening vanaf de Mac (telefoon als camera) heeft wel internet nodig.
- Instellingen die je in het dashboard wijzigt, komen pas door als de booth weer internet heeft en opnieuw wordt geladen.

## Eigen fotostrip uploaden

Ga in het dashboard naar **Ontwerpen** en klik op **Eigen fotostrip uploaden**. Upload een PNG of WebP van je fotostrip waarin de plekken voor de foto's transparant (uitgeknipt) zijn. Het dashboard zoekt de vensters zelf en toont een voorbeeld; het aantal vensters (1 tot 8) is het aantal foto's dat de gast maakt. Via de link in het venster download je een voorbeeldbestand. Kies het ontwerp daarna bij het evenement, net als de andere ontwerpen.

Eigen videokaders (filmstrips) voor de 360°-booth upload je bij **360° extra's**.

## Eigen ontwerpen maken

Ga in het dashboard naar **Ontwerpen** en klik op "+ Nieuw ontwerp" (of "Kopie maken en aanpassen" bij een ingebouwd ontwerp).

- Kaderkleur, achtergrondkleuren, ronde hoeken, kanteling en filmstrip-stijl
- Tekst onderaan de strip
- Stickers: kies uit de ingebouwde set (kroon, druppel, ster, hart, klaver, madelief, vlinder, strik, regenboog, wolk, bel, stip, maan, glinster) of upload je eigen PNG met transparante achtergrond. Sleep ze op het voorbeeld, pas grootte, draaiing en kleur aan
- Kies het ontwerp bij het evenement in het evenementformulier ("Ontwerp"). Het staat vast voor alle gasten

## 360°-booth: eigen muziek en videokaders

Ga in het dashboard naar **360° extra's**.

- **Muziek**: upload MP3, M4A, WAV of OGG (max. 25 MB). Kies bij een 360°-evenement één nummer; het wordt in een lus onder elke video gemixt (met fade-out) en klinkt ook door de speakers tijdens het opnemen. Gasten kunnen het geluid in het overzicht aan- en uitzetten.
- **Videokaders (filmstrips)**: upload een PNG/WebP met transparante achtergrond, bij voorkeur 1920x1080. Het wordt over de hele video gelegd. Er zijn ook twee ingebouwde kaders (Filmstrip en Festiq-kader). Zonder kader krijgt de video de gewone naambalk.
- **Automatische slow-motion**: de booth meet tijdens de opname waar de meeste beweging is en speelt dat stuk (1,5 tot 3 seconden) op halve snelheid af, met zachte in- en uitloop. Daarna wordt de video met kader en muziek opnieuw opgebouwd; dat duurt ongeveer zo lang als de video zelf. Uitzetten kan per evenement via "Bewerken". Op camera's die 60 beelden per seconde halen (zoals de iPad-achtercamera) oogt de slow-motion het vloeiendst.
- Zodra de video klaar is (inclusief eventuele slow-motion) wordt hij automatisch opgeslagen en verschijnt meteen de QR-code; de gast hoeft niets te bevestigen.
- **Kwaliteit**: video's worden opgenomen in Full HD (1920x1080) als de camera dat levert; de naambalk komt over de onderrand. Levert je camera minder (bijvoorbeeld 1280x800), dan is dat het maximum: de browser kan geen scherper beeld maken dan de camera geeft.
- **Welke camera**: de booth kiest zelf een aangesloten capturekaart of HDMI-stick (namen met o.a. capture, HDMI, Elgato, Cam Link) boven de ingebouwde webcam. Met de knop **⟲** wissel je zelf tussen alle aangesloten camera's; die keuze wordt onthouden. Met `?cam=naam` in de link forceer je een camera op (een deel van) de naam.
- **Vloeiende video's**: de opname schrijft per binnenkomend camerabeeld precies één beeld weg (in plaats van op de schermverversing), zodat de gedownloade video niet hapert. Haperen er toch beelden, probeer dan een vaste camerasnelheid met `?fps=30` in de boothlink.
- **Camera-instellingen testen**: voeg `?info` toe aan de boothlink (`/booth/<slug>?info`) om linksboven te zien welke resolutie en framerate de camera werkelijk levert. Met `?res=1280x720&fps=30` kun je een andere stand van de camera forceren. Sommige goedkope webcams leveren op 1080p een zacht, sterk gecomprimeerd beeld; een lagere stand is dan vaak scherper.
- Kies muziek en kader per evenement via "Bewerken" (alleen zichtbaar bij het type 360° booth).

## Gratis draaien op je eigen Mac (zonder terminal)

1. Installeer eenmalig Node.js (de LTS-versie) van nodejs.org.
2. Dubbelklik op **Start-Photobooth.command**. Zegt macOS dat het bestand niet geopend kan worden, klik dan met de rechtermuisknop op het bestand, kies **Open** en bevestig nog een keer **Open**.
3. De eerste keer kies je een wachtwoord voor het dashboard. Daarna installeert en start alles vanzelf, en wordt er een gratis HTTPS-adres aangemaakt (Cloudflare-tunnel).
4. Het venster toont een adres als `https://iets.trycloudflare.com/admin`. Open dat op je Mac en op de iPad. Gebruik altijd dit adres, dan werken de camera en de QR-codes.
5. Sluit het venster om te stoppen. Foto's, video's en instellingen blijven bewaard in de map `data`.

Het adres verandert elke keer dat je opnieuw start, en de Mac moet aan blijven en online zijn zolang de booth gebruikt wordt.

## Online zetten met GitHub en Render (zonder terminal)

1. Ga in Render (render.com) naar New > Blueprint en kies deze GitHub-repo. Render leest `render.yaml` en zet alles goed.
2. Vul bij `ADMIN_PASSWORD` het wachtwoord in dat je voor het dashboard wilt gebruiken.
3. Na een paar minuten staat de photobooth op een `https://...onrender.com`-adres. Daar werkt de camera op de iPad, omdat het HTTPS is. Het dashboard staat op `/admin`.
4. Elke wijziging die je op GitHub zet, gaat daarna automatisch live.

Foto's, video's, muziek en de database staan op een blijvende schijf (`/data`, 10 GB). Die schijf hoort bij het Starter-plan van Render (betaald). Zonder schijf zou alles bij elke herstart verdwijnen. Draai je het zelf op een server, gebruik dan het meegeleverde `Dockerfile` en koppel een volume aan `/data`.

Op het dashboard-overzicht staat bij elk evenement met foto's of video's ook een ZIP-knop, en bovenaan de evenementenlijst staat **⬇ Alles downloaden (ZIP)** om alles van alle evenementen in één keer te downloaden (per evenement in een eigen map binnen de ZIP).

## Belangrijk voor iPad en telefoons

Browsers geven **alleen via HTTPS** (of localhost) toegang tot de camera. Voor een echte iPad-booth moet
het platform dus op een HTTPS-adres draaien. Opties:

1. Hosten (Railway, Render, Fly.io, een VPS met Caddy/Nginx). Dockerfile is meegeleverd. Koppel een
   persistent volume aan `/data`, anders verdwijnen foto's bij een herstart.
2. Tijdelijk testen met een tunnel: `npx cloudflared tunnel --url http://localhost:3000`
   en zet `PUBLIC_URL` op het getoonde adres.

Zet `PUBLIC_URL` zodat de QR-codes naar het publieke adres wijzen en niet naar localhost.

Tip voor iPad: open de booth in Safari, tik op Deel > "Zet op beginscherm" voor een app zonder adresbalk,
en gebruik Begeleide toegang (Guided Access) om de iPad te vergrendelen.
Voor 360°-booths: sluit de camera/iPad aan op het draaiplatform, kies "360° video" en stel de duur in.

## Techniek

Node.js 18+, Express, better-sqlite3, multer, qrcode, archiver. Geen build-stap.
Data staat in `DATA_DIR` (`photobooth.db` en `uploads/`), maak daar een back-up van.

## Huisstijl

De booth, het dashboard, de galerij en de downloadpagina gebruiken de Festiq-huisstijl (logo en kleuren: roze, oranje, paars, blauw op crème).
Het logo staat in `public/festiq-wordmark.jpg` en `public/festiq-logo.jpg`; vervang die bestanden om een ander logo te gebruiken.
