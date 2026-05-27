export default function DataDeletion() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fff', color: '#000', padding: '40px 20px' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto', lineHeight: '1.8', fontSize: '16px' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '30px', textAlign: 'center', color: '#1e293b' }}>
          Eliminación de Datos
        </h1>

        <section style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '15px', borderBottom: '2px solid #7c3aed', paddingBottom: '10px' }}>
            Cómo solicitar la eliminación de tus datos
          </h2>
          <p style={{ marginBottom: '15px', color: '#475569' }}>
            En ZITA, respetamos tu derecho a la privacidad. Si deseas que eliminemos toda la información personal asociada a tu negocio y clientes, puedes enviar una solicitud formal.
          </p>
          <p style={{ marginBottom: '15px', color: '#475569' }}>
            Procesaremos tu solicitud dentro de 30 días de conformidad con la legislación de protección de datos aplicable.
          </p>
        </section>

        <section style={{ marginBottom: '30px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '15px', borderBottom: '2px solid #7c3aed', paddingBottom: '10px' }}>
            Pasos para solicitar eliminación
          </h2>
          <ol style={{ marginLeft: '20px', marginBottom: '15px' }}>
            <li style={{ marginBottom: '12px', color: '#475569' }}>
              <strong>Envía un email</strong> a <a href="mailto:esteban.zita.ia@gmail.com" style={{ color: '#7c3aed', textDecoration: 'none' }}>esteban.zita.ia@gmail.com</a>
            </li>
            <li style={{ marginBottom: '12px', color: '#475569' }}>
              <strong>Asunto:</strong> "Solicitud de Eliminación de Datos"
            </li>
            <li style={{ marginBottom: '12px', color: '#475569' }}>
              <strong>En el email incluye:</strong>
              <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                <li style={{ marginBottom: '6px' }}>Tu nombre completo</li>
                <li style={{ marginBottom: '6px' }}>Email asociado a tu cuenta en ZITA</li>
                <li style={{ marginBottom: '6px' }}>Número de WhatsApp (con código de país)</li>
                <li>Confirmación de que deseas eliminar todos tus datos</li>
              </ul>
            </li>
            <li style={{ marginBottom: '12px', color: '#475569' }}>
              <strong>Recibirás confirmación</strong> de que tu solicitud fue recibida dentro de 48 horas
            </li>
            <li style={{ marginBottom: '12px', color: '#475569' }}>
              <strong>Procesamiento:</strong> Tu solicitud será procesada en los próximos 30 días
            </li>
          </ol>
        </section>

        <section style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#fef3c7', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '10px', color: '#92400e' }}>
            ℹ️ Información importante
          </h3>
          <p style={{ margin: '0', color: '#92400e', fontSize: '14px' }}>
            Una vez eliminados tus datos, no podremos recuperarlos. Esta acción es irreversible.
          </p>
        </section>

        <section style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#eff6ff', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#1e40af' }}>
            Contacto
          </h2>
          <p style={{ marginBottom: '8px', color: '#1e3a8a' }}>
            <strong>Email:</strong> <a href="mailto:esteban.zita.ia@gmail.com" style={{ color: '#7c3aed', textDecoration: 'none' }}>esteban.zita.ia@gmail.com</a>
          </p>
          <p style={{ marginBottom: '0', color: '#1e3a8a', fontSize: '14px' }}>
            Responderemos tu solicitud dentro del plazo legal establecido.
          </p>
        </section>

        <p style={{ textAlign: 'center', color: '#999', fontSize: '12px', marginTop: '40px' }}>
          © 2026 ZITA — Gestión de Citas con WhatsApp
        </p>
      </div>
    </div>
  );
}
