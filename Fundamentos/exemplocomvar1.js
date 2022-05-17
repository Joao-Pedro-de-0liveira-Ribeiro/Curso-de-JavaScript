{
    {
        {
            {
                var sera = 'Será ???' // Sera visivel mesmo fora do bloco
                console.log(sera)
            }
        }
    }
}

console.log(sera)

function teste() {
    var local = 123
    console.log(local) // Não ira encontrar pois a variavel e local da função, e não em todo o programa
}

teste()