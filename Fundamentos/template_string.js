// Template considera quebras de linha, espaços em branco e tabs, ele faz a interpolação da variavel no mesmo meio

const nome = 'Rebeca'
const concatenacao = 'Olá' + nome + '!'
const template = `
    Olá
    ${nome}!` // Usando Template
console.log(concatenacao, template)

// Expressoes
console.log(`1 + 1 = ${1 + 1}`)

const up = texto => texto.toUpperCase() // Função Elow
console.log(`Ei... ${up('cuidado')}!`) // Usando função Elow