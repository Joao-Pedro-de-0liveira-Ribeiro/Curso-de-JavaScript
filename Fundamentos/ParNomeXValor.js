const saudacao = 'Ola Amigo!!!' // Contexto Léxico 1 (Lugar físico onde a variavel foi definida)

function exec() {
    const saudacao = 'Kaka Kiki' // Contexto Léxico 2
    return saudacao
}
// Objetos são grupos aninhados de pares nome/ valor

const Cliente = {
    nome: 'João',
    idade: 25,
    peso: 95,
    endereco: {
        logradouro: 'Rua D',
        numero: 10000015
    }
}
console.log(saudacao)
console.log(exec())
console.log(Cliente)