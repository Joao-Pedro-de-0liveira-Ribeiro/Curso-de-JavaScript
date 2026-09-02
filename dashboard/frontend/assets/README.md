# assets do frontend

Coloque aqui os arquivos estáticos do painel (imagens/logos).

## Logo do DeepSeek (logo oficial)

O painel usa o **arquivo oficial** do logo do DeepSeek se ele existir aqui —
assim fica **exatamente igual** ao original, sem depender de um desenho aproximado.

- Salve o logo como **`deepseek.svg`** (preferido) **ou** **`deepseek.png`** nesta pasta:
  - `dashboard/frontend/assets/deepseek.svg`  (ou `.png`)
- Reinicie o backend (`npm start`) e recarregue a página.

Se o arquivo não existir, o painel mostra uma baleia desenhada como reserva.

O backend serve os arquivos desta pasta em `/assets/...` (somente leitura).
