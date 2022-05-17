console.log(Math.ceil(6.1))
//     ^
//     |
//  Notação Ponto
const Obj1 = {}
Obj1.nome = 'Bola' // Serve para criar dinamicamente funções
console.log(Obj1.nome)

function Obj1(nome) {
    this.nome = nome // Cria atributo de modo publico
    this.exec = function(){
        console.log('Exec...')
    }
}

const Obj2 = new Obj ('Cadeira')
const Obj3 = new Obj ('Mesa')
console.log(Obj2.nome) // Relaciona elementos declarados em funções
console.log(Obj3.nome)
Obj3.exec()