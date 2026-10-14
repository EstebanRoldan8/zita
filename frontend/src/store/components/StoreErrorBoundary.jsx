import { Component } from 'react';
import { clearStoredBag } from '../hooks/cartContext';

// Pantalla de recuperación de la tienda: ningún fallo de un componente deja la página en blanco.
// "Vaciar mi bolsa" borra solo la clave de la bolsa de ESTA tienda en localStorage.
// fullScreen: envuelve toda la tienda; si no, solo el contenido (header y footer siguen visibles).
export default class StoreErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, cleared: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[tienda] error de interfaz:', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearBag = () => {
    clearStoredBag(this.props.slug);
    this.setState({ cleared: true });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const content = (
      <div className="mx-auto max-w-md px-6 py-20 text-center" role="alert">
        <p className="flow-label text-flow-muted">Error</p>
        <h1 className="flow-serif mt-4 text-3xl">Algo salió mal.</h1>
        <p className="mt-4 text-sm text-flow-muted">
          Recarga la página. Si sigue pasando, vacía tu bolsa: puede tener un producto que ya no existe.
        </p>
        <div className="mt-10 grid gap-3">
          <button type="button" onClick={this.handleReload} className="flow-btn flow-btn-primary w-full">Recargar</button>
          <button type="button" onClick={this.handleClearBag} disabled={this.state.cleared} className="flow-btn flow-btn-outline w-full">
            Vaciar mi bolsa
          </button>
        </div>
      </div>
    );
    return this.props.fullScreen
      ? <div className="flow-store flex min-h-screen items-center justify-center">{content}</div>
      : content;
  }
}
