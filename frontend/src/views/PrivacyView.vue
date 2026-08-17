<template>
  <article class="legal-page">
    <RouterLink class="legal-back" to="/">← LaufTrainer</RouterLink>
    <p class="eyebrow">RECHTLICHES</p>
    <h1>Datenschutzerklärung</h1>
    <p class="legal-muted">Stand: August 2026</p>

    <section>
      <h2>1. Verantwortlicher</h2>
      <p>
        Verantwortlich für die Verarbeitung personenbezogener Daten ist Christian Murschall,
        Ostpreußenweg 2, 24257 Hohenfelde, Deutschland.
        Kontakt: <a href="mailto:christian.murschall@googlemail.com">christian.murschall@googlemail.com</a>
      </p>
    </section>

    <section>
      <h2>2. Grundprinzip von LaufTrainer</h2>
      <p>
        LaufTrainer speichert deine Trainingsdaten local-first: Workouts, Ziele, Pläne,
        Einstellungen und Analysen liegen in der Regel nur in diesem Browser auf diesem Gerät
        (technisch in IndexedDB und teilweise im LocalStorage). IndexedDB ist der lokale
        Datenspeicher des Browsers — vergleichbar mit Dateien auf dem Gerät, nicht mit einem
        Cloud-Konto. Es gibt keinen automatischen Upload deiner lokalen Trainingsdaten und
        keinen Abgleich zwischen Geräten. PC und Handy sehen also nicht automatisch dieselben
        Pläne oder Workouts. Zum Wechseln zwischen Geräten kannst du in den Einstellungen ein
        Backup exportieren und auf dem anderen Gerät wieder importieren.
      </p>
    </section>

    <section>
      <h2>3. Hosting und technische Bereitstellung</h2>
      <p>
        Die Webanwendung wird über Cloudflare Pages bereitgestellt. Für Backend-Funktionen
        werden Cloudflare Workers, KV und D1 verwendet. Beim Aufruf können technisch notwendige
        Verbindungs- und Serverdaten verarbeitet werden, insbesondere IP-Adresse, Zeitpunkt,
        aufgerufene Ressource und technische Browserdaten. Die Verarbeitung dient der sicheren
        Bereitstellung, Fehleranalyse und Abwehr von Missbrauch.
      </p>
    </section>

    <section>
      <h2>4. Strava und Polar</h2>
      <p>
        Wenn du Strava oder Polar verbindest, wirst du zur jeweiligen Plattform weitergeleitet.
        Die Verbindung erfolgt nur nach deiner ausdrücklichen Aktion über OAuth. Der Backend-
        Dienst verarbeitet die dafür erforderlichen OAuth-Daten und speichert eine zeitlich
        begrenzte, gerätespezifische Sitzung. Importierte Trainingsdaten werden anschließend
        lokal in deiner LaufTrainer-Installation gespeichert.
      </p>
      <p>
        Für die Verarbeitung gelten zusätzlich die Datenschutzerklärungen von
        <a href="https://www.strava.com/legal/privacy" target="_blank" rel="noreferrer">Strava</a>
        und
        <a href="https://www.polar.com/en/legal/privacy-notice" target="_blank" rel="noreferrer">Polar</a>.
      </p>
    </section>

    <section>
      <h2>5. KI-Trainingsplan</h2>
      <p>
        Ein KI-Trainingsplan wird nur erstellt, wenn du ihn aktiv anforderst und der Übertragung
        zustimmst. Dafür wird eine verdichtete Trainingszusammenfassung an Google Gemini über
        das LaufTrainer-Backend übermittelt. Die vollständige lokale Trainingsdatenbank wird
        dabei nicht automatisch übertragen. Für Google-Dienste gilt zusätzlich die
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Datenschutzerklärung von Google</a>.
      </p>
    </section>

    <section>
      <h2>6. Credits und Zahlungen</h2>
      <p>
        Für Credits wird ein gerätespezifisches Wallet verwendet. Das Guthaben ist dem Browser
        bzw. Gerät zugeordnet, auf dem der Kauf erfolgt — nicht einem Benutzerkonto mit Login.
        Auf einem anderen Gerät startest du daher mit einem eigenen Wallet. Zahlungsabwicklungen
        können über Paddle erfolgen. Dabei verarbeitet Paddle die für die Zahlung erforderlichen
        Daten als eigenständiger Zahlungsdienstleister. Es gelten ergänzend die
        <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noreferrer">Datenschutzinformationen von Paddle</a>.
      </p>
    </section>

    <section>
      <h2>7. Kartendetails (Basemap / PMTiles)</h2>
      <p>
        Die GPS-Spur deines Trainings bleibt lokal auf dem Gerät. Eine Hintergrundkarte
        (Straßen, Gewässer, Wälder aus OpenStreetMap-Daten via Protomaps) wird nur geladen,
        wenn du eine Aktivität aufklappst und dem Laden zustimmst — oder wenn du das in den
        Einstellungen dauerhaft erlaubst.
      </p>
      <p>
        Dafür lädt dein Browser Vector-Tiles per HTTP-Range-Request direkt von unserem
        Karten-Archiv auf Cloudflare R2 (eine PMTiles-Datei für Deutschland). Übermittelt
        werden technisch notwendige Verbindungsdaten (insbesondere deine IP-Adresse) sowie
        welche Kachelbereiche angefragt werden — daraus lässt sich ungefähr ableiten, in
        welcher Gegend die Strecke liegt. Die vollständige Track-Punktliste und
        Trainingsmetriken werden dabei nicht gesendet. LaufTrainer speichert die Anfragen
        nicht als Workout-Historie.
      </p>
      <p>
        Außerhalb des Deutschland-Ausschnitts oder ohne Zustimmung bleibt nur die lokale
        Streckenlinie sichtbar. Schriftarten und Sprites für die Karte können von den
        öffentlichen Protomaps-Asset-Hosts geladen werden.
      </p>
      <p>
        Du kannst die Basemap jederzeit in den Einstellungen ablehnen oder erneut erlauben.
        Ergänzend gelten die Hinweise der OpenStreetMap-Foundation:
        <a href="https://wiki.osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noreferrer"
          >Privacy Policy der OSMF</a
        >
        sowie
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
          >Copyright und Daten</a
        >
        und die Angaben von
        <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>.
      </p>
    </section>

    <section>
      <h2>8. Deine Rechte</h2>
      <p>
        Du hast im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft, Berichtigung,
        Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Für
        Anfragen genügt eine E-Mail an
        <a href="mailto:christian.murschall@googlemail.com">christian.murschall@googlemail.com</a>.
        Du kannst lokale Daten außerdem jederzeit direkt in den Einstellungen von LaufTrainer
        löschen.
      </p>
    </section>
  </article>
</template>
