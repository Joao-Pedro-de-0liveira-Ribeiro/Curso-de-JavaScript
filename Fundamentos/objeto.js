const prod1 = {}  //  Objeto é um coleção de chave valor
prod1.nome = 'Celular Ultra Mega'
prod1.preco = 4998.90
prod1['Desconto Legal'] = 0.40 // Evitar atributos com espaço

console.log(prod1) // É impresso em chaves

const prod2 = {
    nome: 'Camisa Polo',
    preco: 79.90,
    objeto2: {
        propriedade1: 1,
        propriedade2: 2,
        objeto3: {
            propriedade1: 9,
            propriedade2: 10
        }
    }
}

// Objeto não é o mesmo que Json

console.log(prod2)