import { useState } from 'react';
import { imageUrl, imageSrcSet, hasSizedVersions, IMAGE_WIDTHS, DEFAULT_WIDTH } from '../lib/imageUrl';

// <img> de foto de producto: versión reducida (src de 800 px + srcset 400/800/1200 con el sizes de
// cada pantalla). Si cualquier versión falla (404 porque la foto aún no se procesó, u otro error),
// quita el srcset y vuelve a la URL original una sola vez: nunca se ve una foto rota ni hay bucle.
export default function StoreImage({ src, sizes, widths = IMAGE_WIDTHS, baseWidth = DEFAULT_WIDTH, loading = 'lazy', decoding = 'async', onError, ...rest }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const sized = failedSrc !== src && hasSizedVersions(src);
  return (
    <img
      {...rest}
      src={sized ? imageUrl(src, baseWidth) : src}
      srcSet={sized ? imageSrcSet(src, widths) : undefined}
      sizes={sized ? sizes : undefined}
      loading={loading}
      decoding={decoding}
      onError={(e) => { if (sized) setFailedSrc(src); else onError?.(e); }}
    />
  );
}
